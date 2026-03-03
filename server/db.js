import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, 'data', 'knowledge.db')

let dbInstance = null

async function ensureColumn(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`)
  const exists = columns.some((item) => item.name === column)
  if (!exists) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export async function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  dbInstance = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  })

  await dbInstance.exec(`
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

  await ensureColumn(dbInstance, 'documents', 'source_path', 'TEXT')
  await ensureColumn(dbInstance, 'documents', 'version', 'INTEGER NOT NULL DEFAULT 1')

  return dbInstance
}

export async function resetDb() {
  const db = await getDb()
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
