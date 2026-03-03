import 'dotenv/config'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'
import { getDb } from './db.js'
import { embedTexts, cosineSimilarity, getEmbeddingBackendLabel } from './vector.js'
import { chunkText, extractQuestions, extractTextFromUpload } from './text.js'
import { requireAuth, signAccessToken, userHasWorkspaceAccess } from './auth.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
const PORT = Number(process.env.PORT || 8787)

function sanitizeWorkspaceId(value) {
  return String(value || '').trim()
}

function summarizeDraftForExport(draft) {
  if (!Array.isArray(draft)) {
    return []
  }

  return draft.map((item) => ({
    question: String(item.question || '').trim(),
    answer: String(item.answer || '').trim(),
    confidence: `${Math.round(Number(item.confidence || 0) * 100)}%`,
    status: String(item.status || ''),
    source: String(item.source || ''),
  }))
}

function confidenceBand(score) {
  if (score >= 0.75) {
    return 'green'
  }
  if (score >= 0.45) {
    return 'yellow'
  }
  return 'red'
}

function buildFtsQuery(input) {
  const tokens = String(input)
    .toLowerCase()
    .match(/[a-z0-9]+/g)

  if (!tokens || tokens.length === 0) {
    return null
  }

  return tokens.map((token) => `${token}*`).join(' OR ')
}

function buildCutoffIso(recentDays) {
  if (!recentDays) {
    return null
  }
  const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000)
  return cutoff.toISOString()
}

async function getCandidateChunks(db, workspaceId, query, options = {}) {
  const { limit = 300, recentDays = null } = options
  const cutoffIso = buildCutoffIso(recentDays)
  const ftsQuery = buildFtsQuery(query)

  if (!ftsQuery) {
    return db.all(
      `
      SELECT chunks.id, chunks.content, chunks.embedding, documents.file_name, documents.version, documents.added_at
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      WHERE chunks.company_id = ?
      AND (? IS NULL OR documents.added_at >= ?)
      LIMIT ?
      `,
      workspaceId,
      cutoffIso,
      cutoffIso,
      limit,
    )
  }

  const ftsRows = await db.all(
    `
    SELECT c.id, c.content, c.embedding, d.file_name, d.version, d.added_at
    FROM chunks_fts f
    JOIN chunks c ON c.id = f.chunk_id
    JOIN documents d ON d.id = c.document_id
    WHERE f.company_id = ?
    AND chunks_fts MATCH ?
    AND (? IS NULL OR d.added_at >= ?)
    LIMIT ?
    `,
    workspaceId,
    ftsQuery,
    cutoffIso,
    cutoffIso,
    limit,
  )

  if (ftsRows.length > 0) {
    return ftsRows
  }

  return db.all(
    `
    SELECT chunks.id, chunks.content, chunks.embedding, documents.file_name, documents.version, documents.added_at
    FROM chunks
    JOIN documents ON documents.id = chunks.document_id
    WHERE chunks.company_id = ?
    AND (? IS NULL OR documents.added_at >= ?)
    LIMIT ?
    `,
    workspaceId,
    cutoffIso,
    cutoffIso,
    limit,
  )
}

async function assertWorkspaceAccess(userId, workspaceId) {
  if (!workspaceId) {
    return { ok: false, error: 'workspaceId is required.' }
  }

  const membership = await userHasWorkspaceAccess(userId, workspaceId)
  if (!membership) {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  return { ok: true, membership }
}

function toPortalXml(platform, workspaceId, rows) {
  const escaped = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')

  const items = rows
    .map(
      (row, idx) =>
        `  <item index="${idx + 1}">\n    <question>${escaped(row.question)}</question>\n    <answer>${escaped(row.answer)}</answer>\n    <confidence>${escaped(row.confidence)}</confidence>\n    <status>${escaped(row.status)}</status>\n    <source>${escaped(row.source)}</source>\n  </item>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<portalExport platform="${escaped(platform)}" workspaceId="${escaped(workspaceId)}">\n${items}\n</portalExport>`
}

async function writeFilledWorkbook(templateBuffer, draftRows) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBuffer)

  const normalizedDraft = draftRows.map((item) => ({
    question: String(item.question || '').trim(),
    answer: String(item.answer || '').trim(),
    confidence: String(item.confidence || '').trim(),
  }))

  for (const sheet of workbook.worksheets) {
    const answerCol = sheet.columnCount + 1
    const confidenceCol = sheet.columnCount + 2
    sheet.getRow(1).getCell(answerCol).value = 'AI Answer'
    sheet.getRow(1).getCell(confidenceCol).value = 'AI Confidence'

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      const rowText = row.values
        .slice(1)
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      if (!rowText) {
        continue
      }

      const match = normalizedDraft.find((item) => {
        const q = item.question.toLowerCase()
        return rowText.includes(q) || q.includes(rowText)
      })

      if (!match) {
        continue
      }

      row.getCell(answerCol).value = match.answer
      row.getCell(confidenceCol).value = match.confidence
    }
  }

  const summarySheet = workbook.addWorksheet('AI Answers')
  summarySheet.columns = [
    { header: 'Question', key: 'question', width: 45 },
    { header: 'Answer', key: 'answer', width: 80 },
    { header: 'Confidence', key: 'confidence', width: 14 },
  ]
  normalizedDraft.forEach((row) => summarySheet.addRow(row))

  return workbook.xlsx.writeBuffer()
}

function deriveClarifyingQuestions(draft) {
  if (!Array.isArray(draft)) {
    return []
  }

  const questions = []
  for (const item of draft) {
    const confidence = Number(item.confidence || 0)
    if (confidence >= 0.65) {
      continue
    }

    const qText = String(item.question || '').toLowerCase()

    questions.push(`Can you provide exact client/project details for: "${item.question}"?`)
    if (qText.includes('pricing') || qText.includes('commercial')) {
      questions.push('What are your exact pricing assumptions, taxes, and payment milestones?')
    }
    if (qText.includes('timeline') || qText.includes('delivery')) {
      questions.push('What delivery dates and milestone plan should be committed in this bid?')
    }
    if (qText.includes('security') || qText.includes('policy')) {
      questions.push('Which certifications and policy controls should we explicitly mention?')
    }
  }

  return Array.from(new Set(questions)).slice(0, 8)
}

const INDIA_TEMPLATES = [
  {
    id: 'gst-compliance',
    title: 'GST Compliance Statement',
    body: 'Our organization is GST compliant and will provide GSTIN, tax invoice format, and applicable HSN/SAC codes as per contract requirements.',
  },
  {
    id: 'iso-27001',
    title: 'ISO 27001 Security Statement',
    body: 'We maintain an information security management framework aligned to ISO 27001 controls, with periodic audit and access governance reviews.',
  },
  {
    id: 'meity-guidelines',
    title: 'MeitY-Aligned Data Handling',
    body: 'Data handling and security practices align with applicable MeitY guidance and Indian regulatory obligations for confidentiality and retention.',
  },
]

const PLAN_CONFIG = {
  free: { tenderLimitPerMonth: 3, allowFilledExcelExport: false },
  pro: { tenderLimitPerMonth: Number.POSITIVE_INFINITY, allowFilledExcelExport: true },
  team: { tenderLimitPerMonth: Number.POSITIVE_INFINITY, allowFilledExcelExport: true },
}

function normalizePlan(input) {
  const plan = String(input || 'free').toLowerCase()
  return plan === 'pro' || plan === 'team' ? plan : 'free'
}

function currentUsageMonth() {
  return new Date().toISOString().slice(0, 7)
}

async function getWorkspacePlanUsage(db, workspaceId) {
  const workspace = await db.get(
    'SELECT id, plan, tender_usage_month, tender_usage_count FROM workspaces WHERE id = ?',
    workspaceId,
  )

  if (!workspace) {
    return null
  }

  const plan = normalizePlan(workspace.plan)
  const month = currentUsageMonth()
  const storedMonth = String(workspace.tender_usage_month || '')
  const rawCount = Number(workspace.tender_usage_count || 0)
  const usageCount = storedMonth === month ? rawCount : 0

  if (storedMonth !== month || workspace.plan !== plan || rawCount !== usageCount) {
    await db.run(
      'UPDATE workspaces SET plan = ?, tender_usage_month = ?, tender_usage_count = ? WHERE id = ?',
      plan,
      month,
      usageCount,
      workspaceId,
    )
  }

  const cfg = PLAN_CONFIG[plan]
  const remaining =
    cfg.tenderLimitPerMonth === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, cfg.tenderLimitPerMonth - usageCount)

  return {
    plan,
    usageMonth: month,
    usageCount,
    tenderLimitPerMonth: cfg.tenderLimitPerMonth,
    tenderRemaining: remaining,
    allowFilledExcelExport: cfg.allowFilledExcelExport,
  }
}

async function incrementTenderUsage(db, workspaceId, usage) {
  const nextCount = usage.usageCount + 1
  await db.run(
    'UPDATE workspaces SET tender_usage_month = ?, tender_usage_count = ? WHERE id = ?',
    usage.usageMonth,
    nextCount,
    workspaceId,
  )
}

export function createApp() {
  const app = express()

  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
  app.use(express.json({ limit: '4mb' }))
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MAX || 300),
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, embeddings: getEmbeddingBackendLabel() })
  })

  app.get('/api/templates/india', requireAuth, async (_req, res) => {
    res.json({ templates: INDIA_TEMPLATES })
  })

  app.post('/api/auth/register', async (req, res) => {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const workspaceName = String(req.body.workspaceName || '').trim()

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' })
      return
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' })
      return
    }

    try {
      const db = await getDb()
      const existing = await db.get('SELECT id FROM users WHERE email = ?', email)
      if (existing) {
        res.status(409).json({ error: 'Email is already registered.' })
        return
      }

      const userId = crypto.randomUUID()
      const passwordHash = await bcrypt.hash(password, 10)
      const now = new Date().toISOString()

      await db.run(
        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        userId,
        name,
        email,
        passwordHash,
        now,
      )

      let firstWorkspace = null

      if (workspaceName) {
        const workspaceId = crypto.randomUUID()
        const membershipId = crypto.randomUUID()

        await db.run(
          'INSERT INTO workspaces (id, name, created_by_user_id, plan, tender_usage_month, tender_usage_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          workspaceId,
          workspaceName,
          userId,
          'free',
          currentUsageMonth(),
          0,
          now,
        )

        await db.run(
          'INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
          membershipId,
          workspaceId,
          userId,
          'owner',
          now,
        )

        firstWorkspace = {
          id: workspaceId,
          name: workspaceName,
          role: 'owner',
          plan: 'free',
          tenderUsage: { month: currentUsageMonth(), used: 0, limit: 3, remaining: 3 },
        }
      }

      const token = signAccessToken({ userId, email, name })
      res.status(201).json({
        token,
        user: { id: userId, name, email },
        workspaces: firstWorkspace ? [firstWorkspace] : [],
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' })
      return
    }

    try {
      const db = await getDb()
      const user = await db.get('SELECT id, name, email, password_hash FROM users WHERE email = ?', email)

      if (!user) {
        res.status(401).json({ error: 'Invalid credentials.' })
        return
      }

      const isMatch = await bcrypt.compare(password, user.password_hash)
      if (!isMatch) {
        res.status(401).json({ error: 'Invalid credentials.' })
        return
      }

      const workspaces = await db.all(
        `
        SELECT w.id, w.name, m.role, w.plan, w.tender_usage_month, w.tender_usage_count
        FROM workspace_memberships m
        JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ?
        ORDER BY w.created_at DESC
        `,
        user.id,
      )

      const token = signAccessToken({ userId: user.id, email: user.email, name: user.name })

      const normalizedWorkspaces = workspaces.map((workspace) => {
        const plan = normalizePlan(workspace.plan)
        const month = currentUsageMonth()
        const used = workspace.tender_usage_month === month ? Number(workspace.tender_usage_count || 0) : 0
        const limit = PLAN_CONFIG[plan].tenderLimitPerMonth
        return {
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
          plan,
          tenderUsage: {
            month,
            used,
            limit: Number.isFinite(limit) ? limit : null,
            remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null,
          },
        }
      })

      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email },
        workspaces: normalizedWorkspaces,
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      const db = await getDb()
      const user = await db.get('SELECT id, name, email FROM users WHERE id = ?', req.auth.userId)

      if (!user) {
        res.status(404).json({ error: 'User not found.' })
        return
      }

      const workspaces = await db.all(
        `
        SELECT w.id, w.name, m.role, w.plan, w.tender_usage_month, w.tender_usage_count
        FROM workspace_memberships m
        JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ?
        ORDER BY w.created_at DESC
        `,
        user.id,
      )

      const normalizedWorkspaces = workspaces.map((workspace) => {
        const plan = normalizePlan(workspace.plan)
        const month = currentUsageMonth()
        const used = workspace.tender_usage_month === month ? Number(workspace.tender_usage_count || 0) : 0
        const limit = PLAN_CONFIG[plan].tenderLimitPerMonth
        return {
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
          plan,
          tenderUsage: {
            month,
            used,
            limit: Number.isFinite(limit) ? limit : null,
            remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null,
          },
        }
      })

      res.json({ user, workspaces: normalizedWorkspaces })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/workspaces', requireAuth, async (req, res) => {
    const name = String(req.body.name || '').trim()

    if (!name) {
      res.status(400).json({ error: 'Workspace name is required.' })
      return
    }

    try {
      const db = await getDb()
      const workspaceId = crypto.randomUUID()
      const membershipId = crypto.randomUUID()
      const now = new Date().toISOString()

      await db.run(
        'INSERT INTO workspaces (id, name, created_by_user_id, plan, tender_usage_month, tender_usage_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        workspaceId,
        name,
        req.auth.userId,
        'free',
        currentUsageMonth(),
        0,
        now,
      )

      await db.run(
        'INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
        membershipId,
        workspaceId,
        req.auth.userId,
        'owner',
        now,
      )

      res.status(201).json({
        workspace: {
          id: workspaceId,
          name,
          role: 'owner',
          plan: 'free',
          tenderUsage: { month: currentUsageMonth(), used: 0, limit: 3, remaining: 3 },
        },
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.get('/api/workspaces/:workspaceId/usage', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.params.workspaceId)

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const db = await getDb()
      const usage = await getWorkspacePlanUsage(db, workspaceId)
      if (!usage) {
        res.status(404).json({ error: 'Workspace not found.' })
        return
      }

      res.json({
        workspaceId,
        plan: usage.plan,
        tenderUsage: {
          month: usage.usageMonth,
          used: usage.usageCount,
          limit: Number.isFinite(usage.tenderLimitPerMonth) ? usage.tenderLimitPerMonth : null,
          remaining: Number.isFinite(usage.tenderRemaining) ? usage.tenderRemaining : null,
        },
        features: {
          filledExcelExport: usage.allowFilledExcelExport,
        },
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/workspaces/:workspaceId/plan', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.params.workspaceId)
    const nextPlan = normalizePlan(req.body.plan)

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      if (access.membership.role !== 'owner') {
        res.status(403).json({ error: 'Only workspace owner can change plan.' })
        return
      }

      const db = await getDb()
      await db.run('UPDATE workspaces SET plan = ? WHERE id = ?', nextPlan, workspaceId)
      const usage = await getWorkspacePlanUsage(db, workspaceId)

      res.json({
        workspaceId,
        plan: usage.plan,
        tenderUsage: {
          month: usage.usageMonth,
          used: usage.usageCount,
          limit: Number.isFinite(usage.tenderLimitPerMonth) ? usage.tenderLimitPerMonth : null,
          remaining: Number.isFinite(usage.tenderRemaining) ? usage.tenderRemaining : null,
        },
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/knowledge/index', requireAuth, upload.array('files'), async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const files = req.files || []

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const db = await getDb()
      const sourcePathInput = req.body.sourcePath
      const sourcePaths = Array.isArray(sourcePathInput)
        ? sourcePathInput.map((item) => String(item || ''))
        : sourcePathInput
          ? [String(sourcePathInput)]
          : []

      const results = []

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        try {
          const text = await extractTextFromUpload(file)
          const chunks = chunkText(text)

          if (chunks.length === 0) {
            results.push({ fileName: file.originalname, status: 'failed', error: 'No readable text found.' })
            continue
          }

          const sourcePath = (sourcePaths[index] || file.originalname || '').trim() || file.originalname
          const versionRow = await db.get(
            'SELECT MAX(version) as latestVersion FROM documents WHERE company_id = ? AND source_path = ?',
            workspaceId,
            sourcePath,
          )
          const nextVersion = Number(versionRow?.latestVersion || 0) + 1

          const embeddings = await embedTexts(chunks)
          const documentId = crypto.randomUUID()

          await db.exec('BEGIN')
          try {
            await db.run(
              'INSERT INTO documents (id, company_id, file_name, source_path, version, mime_type, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              documentId,
              workspaceId,
              file.originalname,
              sourcePath,
              nextVersion,
              file.mimetype || 'application/octet-stream',
              new Date().toISOString(),
            )

            for (let i = 0; i < chunks.length; i += 1) {
              const insertResult = await db.run(
                'INSERT INTO chunks (company_id, document_id, content, embedding) VALUES (?, ?, ?, ?)',
                workspaceId,
                documentId,
                chunks[i],
                JSON.stringify(embeddings[i]),
              )

              await db.run(
                'INSERT INTO chunks_fts(rowid, content, company_id, chunk_id) VALUES (?, ?, ?, ?)',
                insertResult.lastID,
                chunks[i],
                workspaceId,
                insertResult.lastID,
              )
            }

            await db.exec('COMMIT')
          } catch (error) {
            await db.exec('ROLLBACK')
            throw error
          }

          results.push({
            fileName: file.originalname,
            sourcePath,
            status: 'indexed',
            version: nextVersion,
            chunkCount: chunks.length,
            extractedChars: text.length,
          })
        } catch (error) {
          results.push({
            fileName: file.originalname,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Failed to index file.',
          })
        }
      }

      res.json({
        workspaceId,
        indexed: results.filter((item) => item.status === 'indexed').length,
        failed: results.filter((item) => item.status === 'failed').length,
        files: results,
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/retrieve', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const query = String(req.body.query || '').trim()
    const topK = Math.max(1, Math.min(20, Number(req.body.topK || 5)))
    const useLastQuarter = Boolean(req.body.useLastQuarter)

    if (!query) {
      res.status(400).json({ error: 'Query is required.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const db = await getDb()
      const queryEmbedding = (await embedTexts([query]))[0]
      const rows = await getCandidateChunks(db, workspaceId, query, {
        recentDays: useLastQuarter ? 90 : null,
      })

      const scored = rows
        .map((row) => {
          const embedding = JSON.parse(row.embedding)
          const score = cosineSimilarity(queryEmbedding, embedding)
          return {
            id: row.id,
            content: row.content,
            source: `${row.file_name} (v${row.version})`,
            score,
            band: confidenceBand(score),
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)

      res.json({ workspaceId, query, results: scored })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/tender/parse', requireAuth, upload.single('file'), async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const file = req.file

    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const text = await extractTextFromUpload(file)
      const questions = extractQuestions(text)

      res.json({
        workspaceId,
        fileName: file.originalname,
        textLength: text.length,
        questions,
      })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not parse tender.' })
    }
  })

  app.post('/api/tender/draft', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const questions = Array.isArray(req.body.questions)
      ? req.body.questions.map((item) => String(item).trim()).filter(Boolean)
      : []
    const useLastQuarter = Boolean(req.body.useLastQuarter)

    if (questions.length === 0) {
      res.status(400).json({ error: 'Questions are required.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const db = await getDb()
      const usage = await getWorkspacePlanUsage(db, workspaceId)
      if (!usage) {
        res.status(404).json({ error: 'Workspace not found.' })
        return
      }
      if (Number.isFinite(usage.tenderRemaining) && usage.tenderRemaining <= 0) {
        res.status(402).json({
          error: 'Free plan limit reached (3 tenders/month). Upgrade to Pro for unlimited drafts.',
          plan: usage.plan,
          tenderUsage: {
            month: usage.usageMonth,
            used: usage.usageCount,
            limit: usage.tenderLimitPerMonth,
            remaining: usage.tenderRemaining,
          },
        })
        return
      }
      const questionEmbeddings = await embedTexts(questions)

      const draft = []
      for (let idx = 0; idx < questions.length; idx += 1) {
        const question = questions[idx]
        const questionEmbedding = questionEmbeddings[idx]
        const rows = await getCandidateChunks(db, workspaceId, question, {
          recentDays: useLastQuarter ? 90 : null,
        })

        if (rows.length === 0) {
          draft.push({
            id: `q-${idx + 1}`,
            question,
            answer: 'No indexed knowledge found for this workspace.',
            confidence: 0,
            band: 'red',
            status: 'needs-attention',
            source: 'No strong match found',
            citations: [],
          })
          continue
        }

        const topMatches = rows
          .map((row) => ({
            id: row.id,
            content: row.content,
            source: `${row.file_name} (v${row.version})`,
            score: cosineSimilarity(questionEmbedding, JSON.parse(row.embedding)),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)

        const topScore = topMatches[0]?.score ?? 0
        const evidence = topMatches.map((match) => match.content.slice(0, 260)).join(' ')
        const sourceSet = Array.from(new Set(topMatches.map((match) => match.source)))
        const citations = topMatches.map((match) => ({
          source: match.source,
          snippet: match.content.slice(0, 260),
          score: Number(Math.max(0, Math.min(1, match.score)).toFixed(2)),
        }))

        draft.push({
          id: `q-${idx + 1}`,
          question,
          answer:
            topScore >= 0.28
              ? `Based on previous winning proposals: ${evidence}`
              : 'Low-confidence retrieval. Please provide a tailored response with project-specific details.',
          confidence: Number(Math.max(0, Math.min(1, topScore)).toFixed(2)),
          band: confidenceBand(topScore),
          status: topScore >= 0.28 ? 'ready' : 'needs-attention',
          source: sourceSet.join(', ') || 'No strong match found',
          citations,
        })
      }

      await incrementTenderUsage(db, workspaceId, usage)

      const nextUsed = usage.usageCount + 1
      const limit = usage.tenderLimitPerMonth
      res.json({
        workspaceId,
        draft,
        plan: usage.plan,
        tenderUsage: {
          month: usage.usageMonth,
          used: nextUsed,
          limit: Number.isFinite(limit) ? limit : null,
          remaining: Number.isFinite(limit) ? Math.max(0, limit - nextUsed) : null,
        },
      })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/tender/clarify', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const draft = Array.isArray(req.body.draft) ? req.body.draft : []

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const clarifications = deriveClarifyingQuestions(draft)
      res.json({ workspaceId, clarifications })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/tender/export', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const format = String(req.body.format || 'xlsx').toLowerCase()
    const rows = summarizeDraftForExport(req.body.draft)

    if (rows.length === 0) {
      res.status(400).json({ error: 'Draft content is required for export.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Tender Draft')
        sheet.columns = [
          { header: 'Question', key: 'question', width: 45 },
          { header: 'Answer', key: 'answer', width: 80 },
          { header: 'Confidence', key: 'confidence', width: 14 },
          { header: 'Status', key: 'status', width: 18 },
          { header: 'Source', key: 'source', width: 40 },
        ]
        rows.forEach((row) => sheet.addRow(row))

        const buffer = await workbook.xlsx.writeBuffer()
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        res.setHeader('Content-Disposition', 'attachment; filename="tender-draft.xlsx"')
        res.send(Buffer.from(buffer))
        return
      }

      if (format === 'pdf') {
        const pdf = new PDFDocument({ margin: 40 })
        const chunks = []

        pdf.on('data', (chunk) => chunks.push(chunk))
        pdf.on('end', () => {
          const buffer = Buffer.concat(chunks)
          res.setHeader('Content-Type', 'application/pdf')
          res.setHeader('Content-Disposition', 'attachment; filename="tender-draft.pdf"')
          res.send(buffer)
        })

        pdf.fontSize(18).text('Tender Draft Export', { underline: true })
        pdf.moveDown()

        rows.forEach((row, index) => {
          pdf.fontSize(12).text(`${index + 1}. ${row.question}`)
          pdf.fontSize(10).text(`Answer: ${row.answer}`)
          pdf.fontSize(10).text(`Confidence: ${row.confidence} | Status: ${row.status}`)
          pdf.fontSize(10).text(`Source: ${row.source}`)
          pdf.moveDown()
        })

        pdf.end()
        return
      }

      res.status(400).json({ error: 'Unsupported export format. Use xlsx or pdf.' })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  app.post('/api/tender/export-filled', requireAuth, upload.single('file'), async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const file = req.file
    let draft = []

    try {
      draft = JSON.parse(String(req.body.draft || '[]'))
    } catch {
      res.status(400).json({ error: 'Invalid draft payload.' })
      return
    }

    if (!file) {
      res.status(400).json({ error: 'Original xlsx file is required.' })
      return
    }

    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      res.status(400).json({ error: 'Only .xlsx template files are supported for filled export.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      const db = await getDb()
      const usage = await getWorkspacePlanUsage(db, workspaceId)
      if (!usage) {
        res.status(404).json({ error: 'Workspace not found.' })
        return
      }
      if (!usage.allowFilledExcelExport) {
        res.status(402).json({
          error: 'Filled Excel export is available on Pro and Team plans only.',
          plan: usage.plan,
        })
        return
      }

      const buffer = await writeFilledWorkbook(file.buffer, draft)
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      res.setHeader('Content-Disposition', 'attachment; filename="tender-filled.xlsx"')
      res.send(Buffer.from(buffer))
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate filled excel.' })
    }
  })

  app.post('/api/tender/export-portal', requireAuth, async (req, res) => {
    const workspaceId = sanitizeWorkspaceId(req.body.workspaceId)
    const format = String(req.body.format || 'json').toLowerCase()
    const platform = String(req.body.platform || 'generic').toLowerCase()
    const rows = summarizeDraftForExport(req.body.draft)

    if (rows.length === 0) {
      res.status(400).json({ error: 'Draft content is required.' })
      return
    }

    try {
      const access = await assertWorkspaceAccess(req.auth.userId, workspaceId)
      if (!access.ok) {
        res.status(403).json({ error: access.error })
        return
      }

      if (format === 'json') {
        res.json({ platform, workspaceId, items: rows })
        return
      }

      if (format === 'xml') {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8')
        res.send(toPortalXml(platform, workspaceId, rows))
        return
      }

      res.status(400).json({ error: 'Unsupported format. Use json or xml.' })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
    }
  })

  return app
}

export function startServer(port = PORT) {
  const app = createApp()
  return app.listen(port, () => {
    console.log(`Tender backend running on http://localhost:${port}`)
  })
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  startServer()
}
