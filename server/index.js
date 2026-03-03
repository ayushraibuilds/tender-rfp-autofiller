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

function buildFtsQuery(input) {
  const tokens = String(input)
    .toLowerCase()
    .match(/[a-z0-9]+/g)

  if (!tokens || tokens.length === 0) {
    return null
  }

  return tokens.map((token) => `${token}*`).join(' OR ')
}

async function getCandidateChunks(db, workspaceId, query, limit = 300) {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) {
    return db.all(
      `
      SELECT chunks.id, chunks.content, chunks.embedding, documents.file_name, documents.version
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      WHERE chunks.company_id = ?
      LIMIT ?
      `,
      workspaceId,
      limit,
    )
  }

  const ftsRows = await db.all(
    `
    SELECT c.id, c.content, c.embedding, d.file_name, d.version
    FROM chunks_fts f
    JOIN chunks c ON c.id = f.chunk_id
    JOIN documents d ON d.id = c.document_id
    WHERE f.company_id = ? AND chunks_fts MATCH ?
    LIMIT ?
    `,
    workspaceId,
    ftsQuery,
    limit,
  )

  if (ftsRows.length > 0) {
    return ftsRows
  }

  return db.all(
    `
    SELECT chunks.id, chunks.content, chunks.embedding, documents.file_name, documents.version
    FROM chunks
    JOIN documents ON documents.id = chunks.document_id
    WHERE chunks.company_id = ?
    LIMIT ?
    `,
    workspaceId,
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

export function createApp() {
  const app = express()

  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
  app.use(express.json({ limit: '2mb' }))
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
          'INSERT INTO workspaces (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)',
          workspaceId,
          workspaceName,
          userId,
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

        firstWorkspace = { id: workspaceId, name: workspaceName, role: 'owner' }
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
        SELECT w.id, w.name, m.role
        FROM workspace_memberships m
        JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ?
        ORDER BY w.created_at DESC
        `,
        user.id,
      )

      const token = signAccessToken({ userId: user.id, email: user.email, name: user.name })

      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email },
        workspaces,
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
        SELECT w.id, w.name, m.role
        FROM workspace_memberships m
        JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ?
        ORDER BY w.created_at DESC
        `,
        user.id,
      )

      res.json({ user, workspaces })
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
        'INSERT INTO workspaces (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)',
        workspaceId,
        name,
        req.auth.userId,
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

      res.status(201).json({ workspace: { id: workspaceId, name, role: 'owner' } })
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
      const rows = await getCandidateChunks(db, workspaceId, query)

      const scored = rows
        .map((row) => {
          const embedding = JSON.parse(row.embedding)
          const score = cosineSimilarity(queryEmbedding, embedding)
          return {
            id: row.id,
            content: row.content,
            source: `${row.file_name} (v${row.version})`,
            score,
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
      const questionEmbeddings = await embedTexts(questions)

      const draft = []
      for (let idx = 0; idx < questions.length; idx += 1) {
        const question = questions[idx]
        const questionEmbedding = questionEmbeddings[idx]
        const rows = await getCandidateChunks(db, workspaceId, question)

        if (rows.length === 0) {
          draft.push({
            id: `q-${idx + 1}`,
            question,
            answer: 'No indexed knowledge found for this workspace.',
            confidence: 0,
            status: 'needs-attention',
            source: 'No strong match found',
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

        draft.push({
          id: `q-${idx + 1}`,
          question,
          answer:
            topScore >= 0.28
              ? `Based on previous winning proposals: ${evidence}`
              : 'Low-confidence retrieval. Please provide a tailored response with project-specific details.',
          confidence: Number(Math.max(0, Math.min(1, topScore)).toFixed(2)),
          status: topScore >= 0.28 ? 'ready' : 'needs-attention',
          source: sourceSet.join(', ') || 'No strong match found',
        })
      }

      res.json({ workspaceId, draft })
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
