# TenderPilot AI

Tender/RFP auto-filler for agencies, construction teams, and IT service companies.

## What is implemented
- Frontend: contractor-friendly workflow with drag-drop upload, folder upload, side-by-side review, and export actions.
- Backend: Express API with document parsing, transactional indexing, hybrid retrieval (FTS prefilter + vector rerank), and draft export.
- Auth: JWT-based register/login with workspace membership checks.
- Workspace isolation: all indexing and retrieval are scoped per workspace.
- Knowledge versioning: repeated uploads of same source path auto-increment versions.
- Storage: SQLite database persisted at `server/data/knowledge.db`.

## Tech stack
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express
- Parsing: `pdf-parse`, `mammoth`, `exceljs`
- Vector search: local Ollama embeddings by default; OpenAI optional premium mode
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

3. Choose embeddings backend:
- Default private/local mode:
```bash
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

- Premium OpenAI mode:
```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
```

4. Set a strong JWT secret in `.env`:
```bash
JWT_SECRET=replace-with-a-strong-random-secret
```

5. Production mode safety:
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
- `POST /api/knowledge/index` (`multipart/form-data`, fields: `workspaceId`, `files[]`, requires auth)
- `POST /api/retrieve` (`workspaceId`, `query`, `topK`, requires auth)
- `POST /api/tender/parse` (`multipart/form-data`, fields: `workspaceId`, `file`, requires auth)
- `POST /api/tender/draft` (`workspaceId`, `questions[]`, requires auth)
- `POST /api/tender/export` (`workspaceId`, `draft[]`, `format=xlsx|pdf`, requires auth)

## Production readiness
- Rate limiting is enabled globally (`RATE_LIMIT_MAX` requests per 15 minutes).
- JWT secret enforcement is enabled for production startup.
- Indexing writes use DB transactions to prevent partial document/chunk inserts.
- Retrieval uses SQLite FTS prefiltering before vector similarity reranking.

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
