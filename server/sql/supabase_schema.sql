-- TenderPilot AI schema for Supabase Postgres

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
