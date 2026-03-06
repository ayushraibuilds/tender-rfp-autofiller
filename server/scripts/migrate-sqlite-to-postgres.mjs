import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import pg from 'pg'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'knowledge.db')
const pgUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

if (!pgUrl) {
  throw new Error('Set SUPABASE_DB_URL (or DATABASE_URL) before running migration.')
}

const sqliteDb = await open({ filename: sqlitePath, driver: sqlite3.Database })
const pool = new Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } })

async function migrateTable(table, columns) {
  const rows = await sqliteDb.all(`SELECT ${columns.join(', ')} FROM ${table}`)
  if (rows.length === 0) {
    return 0
  }

  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ')
  const updates = columns
    .filter((col) => col !== 'id')
    .map((col) => `${col} = EXCLUDED.${col}`)
    .join(', ')

  const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${updates}
  `

  for (const row of rows) {
    const values = columns.map((col) => row[col])
    await pool.query(sql, values)
  }

  return rows.length
}

try {
  await pool.query('BEGIN')

  const userCount = await migrateTable('users', ['id', 'name', 'email', 'password_hash', 'created_at'])
  const workspaceCount = await migrateTable('workspaces', [
    'id',
    'name',
    'created_by_user_id',
    'plan',
    'tender_usage_month',
    'tender_usage_count',
    'created_at',
  ])
  const membershipCount = await migrateTable('workspace_memberships', [
    'id',
    'workspace_id',
    'user_id',
    'role',
    'created_at',
  ])
  const documentCount = await migrateTable('documents', [
    'id',
    'company_id',
    'file_name',
    'source_path',
    'version',
    'mime_type',
    'added_at',
  ])

  const chunks = await sqliteDb.all('SELECT company_id, document_id, content, embedding FROM chunks')
  for (const chunk of chunks) {
    await pool.query(
      'INSERT INTO chunks (company_id, document_id, content, embedding) VALUES ($1, $2, $3, $4)',
      [chunk.company_id, chunk.document_id, chunk.content, chunk.embedding],
    )
  }

  await pool.query('COMMIT')

  console.log(
    JSON.stringify(
      {
        ok: true,
        migrated: {
          users: userCount,
          workspaces: workspaceCount,
          memberships: membershipCount,
          documents: documentCount,
          chunks: chunks.length,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  await pool.query('ROLLBACK')
  throw error
} finally {
  await sqliteDb.close()
  await pool.end()
}
