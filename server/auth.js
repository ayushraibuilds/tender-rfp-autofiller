import jwt from 'jsonwebtoken'
import { getDb } from './db.js'

const DEFAULT_JWT_SECRET = 'dev-only-secret-change-me'
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET
const NODE_ENV = process.env.NODE_ENV || 'development'

if (NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.')
}

export function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Missing auth token.' })
    return
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.auth = { userId: decoded.userId, email: decoded.email, name: decoded.name }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired auth token.' })
  }
}

export async function userHasWorkspaceAccess(userId, workspaceId) {
  const db = await getDb()
  const membership = await db.get(
    'SELECT id, role FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?',
    userId,
    workspaceId,
  )

  return membership || null
}
