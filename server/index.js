import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import { getDb } from './db.js'
import { embedTexts, cosineSimilarity, isUsingOpenAIEmbeddings } from './vector.js'
import { chunkText, extractQuestions, extractTextFromUpload } from './text.js'
import { requireAuth, signAccessToken, userHasWorkspaceAccess } from './auth.js'

const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
const PORT = Number(process.env.PORT || 8787)

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '2mb' }))

function sanitizeWorkspaceId(value) {
  return String(value || '').trim()
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

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, embeddings: isUsingOpenAIEmbeddings() ? 'openai' : 'fallback-hash' })
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
    const results = []

    for (const file of files) {
      try {
        const text = await extractTextFromUpload(file)
        const chunks = chunkText(text)

        if (chunks.length === 0) {
          results.push({ fileName: file.originalname, status: 'failed', error: 'No readable text found.' })
          continue
        }

        const embeddings = await embedTexts(chunks)
        const documentId = crypto.randomUUID()

        await db.run(
          'INSERT INTO documents (id, company_id, file_name, mime_type, added_at) VALUES (?, ?, ?, ?, ?)',
          documentId,
          workspaceId,
          file.originalname,
          file.mimetype || 'application/octet-stream',
          new Date().toISOString(),
        )

        for (let i = 0; i < chunks.length; i += 1) {
          await db.run(
            'INSERT INTO chunks (company_id, document_id, content, embedding) VALUES (?, ?, ?, ?)',
            workspaceId,
            documentId,
            chunks[i],
            JSON.stringify(embeddings[i]),
          )
        }

        results.push({
          fileName: file.originalname,
          status: 'indexed',
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

    const rows = await db.all(
      `
      SELECT chunks.id, chunks.content, chunks.embedding, documents.file_name
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      WHERE chunks.company_id = ?
      `,
      workspaceId,
    )

    const scored = rows
      .map((row) => {
        const embedding = JSON.parse(row.embedding)
        const score = cosineSimilarity(queryEmbedding, embedding)
        return {
          id: row.id,
          content: row.content,
          source: row.file_name,
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
    const rows = await db.all(
      `
      SELECT chunks.id, chunks.content, chunks.embedding, documents.file_name
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      WHERE chunks.company_id = ?
      `,
      workspaceId,
    )

    if (rows.length === 0) {
      res.status(400).json({ error: 'No indexed knowledge found for this workspace.' })
      return
    }

    const chunkStore = rows.map((row) => ({
      id: row.id,
      content: row.content,
      source: row.file_name,
      embedding: JSON.parse(row.embedding),
    }))

    const questionEmbeddings = await embedTexts(questions)

    const draft = questionEmbeddings.map((questionEmbedding, idx) => {
      const question = questions[idx]
      const topMatches = chunkStore
        .map((chunk) => ({
          ...chunk,
          score: cosineSimilarity(questionEmbedding, chunk.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      const topScore = topMatches[0]?.score ?? 0
      const evidence = topMatches.map((match) => match.content.slice(0, 260)).join(' ')
      const sourceSet = Array.from(new Set(topMatches.map((match) => match.source)))

      const answer =
        topScore >= 0.28
          ? `Based on previous winning proposals: ${evidence}`
          : 'Low-confidence retrieval. Please provide a tailored response with project-specific details.'

      return {
        id: `q-${idx + 1}`,
        question,
        answer,
        confidence: Number(Math.max(0, Math.min(1, topScore)).toFixed(2)),
        status: topScore >= 0.28 ? 'ready' : 'needs-attention',
        source: sourceSet.join(', ') || 'No strong match found',
      }
    })

    res.json({ workspaceId, draft })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Server error.' })
  }
})

app.listen(PORT, () => {
  console.log(`Tender backend running on http://localhost:${PORT}`)
})
