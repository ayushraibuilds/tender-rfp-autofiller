# TenderPilot AI

Tender/RFP auto-filler for agencies, construction teams, and IT service companies.

## What is implemented
- Frontend: contractor-friendly workflow for setup, knowledge upload, tender upload, and draft review.
- Backend: Express API with document parsing, chunking, embeddings, and vector retrieval.
- Auth: JWT-based register/login with workspace membership checks.
- Storage: SQLite database persisted at `server/data/knowledge.db`.
- Retrieval pipeline: knowledge files are parsed and indexed; tender questions retrieve top matching chunks to draft answers.

## Tech stack
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express
- Parsing: `pdf-parse`, `mammoth`
- Vector search: OpenAI embeddings (`text-embedding-3-small`) or local hash-vector fallback
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

3. (Optional, recommended) add OpenAI key in `.env` for higher-quality embeddings:
```bash
OPENAI_API_KEY=your_key_here
```

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

## Build
```bash
npm run build
```
