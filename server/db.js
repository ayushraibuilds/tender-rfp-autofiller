import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import pg from 'pg'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, 'data', 'knowledge.db')

const DB_PROVIDER = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase()
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || ''

let dbInstance = null
let pgPool = null

function mapPlaceholders(sql) {
  let idx = 0
  return sql.replace(/\?/g, () => {
    idx += 1
    return `$${idx}`
  })
}

function createPgAdapter(pool) {
  return {
    dialect: 'postgres',
    async get(sql, ...params) {
      const query = mapPlaceholders(sql)
      const result = await pool.query(query, params)
      return result.rows[0] || undefined
    },
    async all(sql, ...params) {
      const query = mapPlaceholders(sql)
      const result = await pool.query(query, params)
      return result.rows
    },
    async run(sql, ...params) {
      const query = mapPlaceholders(sql)
      const result = await pool.query(query, params)
      return { changes: result.rowCount || 0, rowCount: result.rowCount || 0, rows: result.rows }
    },
    async exec(sql) {
      await pool.query(sql)
    },
  }
}

async function ensureColumnSqlite(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`)
  const exists = columns.some((item) => item.name === column)
  if (!exists) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function ensureColumnPostgres(pool, table, column, definition) {
  const result = await pool.query(
    `
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    LIMIT 1
    `,
    [table, column],
  )

  if (result.rowCount === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function initSqlite() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  })

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      tender_usage_month TEXT,
      tender_usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workspace_memberships (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      UNIQUE(workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      source_path TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      mime_type TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      company_id UNINDEXED,
      chunk_id UNINDEXED
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_company ON chunks(company_id);
    CREATE INDEX IF NOT EXISTS idx_documents_company_file_source ON documents(company_id, file_name, source_path);
    CREATE INDEX IF NOT EXISTS idx_workspace_membership_user ON workspace_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_membership_workspace ON workspace_memberships(workspace_id);
  `)

  await ensureColumnSqlite(db, 'documents', 'source_path', 'TEXT')
  await ensureColumnSqlite(db, 'documents', 'version', 'INTEGER NOT NULL DEFAULT 1')
  await ensureColumnSqlite(db, 'workspaces', 'plan', "TEXT NOT NULL DEFAULT 'free'")
  await ensureColumnSqlite(db, 'workspaces', 'tender_usage_month', 'TEXT')
  await ensureColumnSqlite(db, 'workspaces', 'tender_usage_count', 'INTEGER NOT NULL DEFAULT 0')

  db.dialect = 'sqlite'
  return db
}

async function initPostgres() {
  if (!SUPABASE_DB_URL) {
    throw new Error('SUPABASE_DB_URL (or DATABASE_URL) is required when DATABASE_PROVIDER=supabase')
  }

  pgPool = new Pool({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  })

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      plan TEXT NOT NULL DEFAULT 'free',
      tender_usage_month TEXT,
      tender_usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_memberships (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      source_path TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      mime_type TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      document_id TEXT NOT NULL REFERENCES documents(id),
      content TEXT NOT NULL,
      embedding TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_company ON chunks(company_id);
    CREATE INDEX IF NOT EXISTS idx_documents_company_file_source ON documents(company_id, file_name, source_path);
    CREATE INDEX IF NOT EXISTS idx_workspace_membership_user ON workspace_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_membership_workspace ON workspace_memberships(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv ON chunks USING GIN (to_tsvector('simple', content));
  `)

  await ensureColumnPostgres(pgPool, 'documents', 'source_path', 'TEXT')
  await ensureColumnPostgres(pgPool, 'documents', 'version', 'INTEGER NOT NULL DEFAULT 1')
  await ensureColumnPostgres(pgPool, 'workspaces', 'plan', "TEXT NOT NULL DEFAULT 'free'")
  await ensureColumnPostgres(pgPool, 'workspaces', 'tender_usage_month', 'TEXT')
  await ensureColumnPostgres(pgPool, 'workspaces', 'tender_usage_count', 'INTEGER NOT NULL DEFAULT 0')

  return createPgAdapter(pgPool)
}

export async function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  if (DB_PROVIDER === 'supabase' || DB_PROVIDER === 'postgres') {
    dbInstance = await initPostgres()
    return dbInstance
  }

  dbInstance = await initSqlite()
  return dbInstance
}

export function getDbDialect() {
  if (DB_PROVIDER === 'supabase' || DB_PROVIDER === 'postgres') {
    return 'postgres'
  }
  return 'sqlite'
}

export async function resetDb() {
  const db = await getDb()

  if (getDbDialect() === 'postgres') {
    await db.exec(`
      TRUNCATE TABLE chunks, documents, workspace_memberships, workspaces, users RESTART IDENTITY CASCADE;
    `)
    return
  }

  await db.exec(`
    DELETE FROM chunks_fts;
    DELETE FROM chunks;
    DELETE FROM documents;
    DELETE FROM workspace_memberships;
    DELETE FROM workspaces;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `)
}
