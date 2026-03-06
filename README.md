# TenderPilot AI

Tender/RFP auto-filler for agencies, construction teams, and IT service companies.

## What is implemented
- Frontend: launch-ready landing page + contractor-friendly app workflow with drag-drop upload, folder upload, side-by-side review, editable answers, trust tags, and export actions.
- Backend: Express API with document parsing, transactional indexing, hybrid retrieval (FTS prefilter + vector rerank), and multiple export paths.
- Auth: JWT-based register/login with workspace membership checks.
- Workspace isolation: all indexing and retrieval are scoped per workspace.
- Knowledge versioning: repeated uploads of same source path auto-increment versions.
- Subscription tiers: Free/Pro/Team plans with tender usage tracking and feature gates.
- Storage: SQLite (default) or Supabase Postgres (`DATABASE_PROVIDER=supabase`).
- Browser extension MVP for portal autofill with direct backend draft generation.

## Tech stack
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express
- Parsing: `pdf-parse`, `mammoth`, `exceljs`
- Vector search: Groq by default; Ollama/OpenAI optional
- Export: `exceljs`, `pdfkit`
- Database: SQLite (`sqlite3` + `sqlite`)

## Setup
1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Select database:
- SQLite local default:
```bash
DATABASE_PROVIDER=sqlite
```
- Supabase Postgres:
```bash
DATABASE_PROVIDER=supabase
SUPABASE_DB_URL=postgresql://...
```

4. Choose embeddings backend:
- Default Groq mode:
```bash
EMBEDDING_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_EMBEDDING_MODEL=text-embedding-3-small
```

- Local/private mode:
```bash
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

- OpenAI mode:
```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
```

5. Set a strong JWT secret in `.env`:
```bash
JWT_SECRET=replace-with-a-strong-random-secret
```

6. Production mode safety:
```bash
NODE_ENV=production
```
In production, server startup fails if `JWT_SECRET` is not configured.

## Run
- Run frontend + backend together:
```bash
npm run dev:full
```

- Or separately:
```bash
npm run server
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:8787`

## API endpoints
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId/usage` (plan + monthly tender usage)
- `POST /api/workspaces/:workspaceId/plan` (owner-only plan change)
- `POST /api/knowledge/index` (`multipart/form-data`, fields: `workspaceId`, `files[]`, requires auth)
- `POST /api/retrieve` (`workspaceId`, `query`, `topK`, requires auth)
- `GET /api/templates/india` (preloaded India-specific templates)
- `POST /api/tender/parse` (`multipart/form-data`, fields: `workspaceId`, `file`, requires auth)
- `POST /api/tender/draft` (`workspaceId`, `questions[]`, `useLastQuarter`, requires auth)
  - Free plan: max 3 draft generations per workspace per month
- `POST /api/tender/clarify` (`workspaceId`, `draft[]`, returns clarifying questions)
- `POST /api/tender/export` (`workspaceId`, `draft[]`, `format=xlsx|pdf`, requires auth)
- `POST /api/tender/export-filled` (`workspaceId`, `file:.xlsx`, `draft[]`, returns filled workbook; Pro/Team only)
- `POST /api/tender/export-portal` (`workspaceId`, `draft[]`, `format=json|xml`, `platform`, requires auth)

## Production readiness
- Rate limiting is enabled globally (`RATE_LIMIT_MAX` requests per 15 minutes).
- JWT secret enforcement is enabled for production startup.
- Indexing writes use DB transactions to prevent partial document/chunk inserts.
- Retrieval uses DB-native prefiltering (SQLite FTS5 or Postgres `to_tsvector`) before vector similarity reranking.

## Supabase migration
1. Create/open your Supabase project and copy Postgres connection string.
2. Run schema SQL in Supabase SQL editor:
   - `server/sql/supabase_schema.sql`
3. Migrate local SQLite data:
```bash
SUPABASE_DB_URL=postgresql://... npm run migrate:supabase
```
4. Switch runtime provider:
```bash
DATABASE_PROVIDER=supabase
SUPABASE_DB_URL=postgresql://...
```

## Browser extension (MVP)
- Folder: `extension/`
- Supports `Generate + Fill`: collects page questions, calls `/api/tender/draft`, then fills matched fields.
- Also supports manual JSON paste fallback.

## Deploy quick path
- Railway:
1. Create new project from repo.
2. Add `.env` variables from `.env.example`.
3. Set start command to `npm run server`.

- Render:
1. Create new Web Service from repo.
2. Build command: `npm install`.
3. Start command: `npm run server`.
4. Add `.env` variables from `.env.example`.

## Build
```bash
npm run build
```

## Test
```bash
npm run test
```
