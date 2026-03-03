const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787'

export type IndexedFileResult = {
  fileName: string
  status: 'indexed' | 'failed'
  chunkCount?: number
  extractedChars?: number
  error?: string
}

export type DraftQuestion = {
  id: string
  question: string
  answer: string
  confidence: number
  status: 'ready' | 'needs-attention'
  source: string
}

export type UserProfile = {
  id: string
  name: string
  email: string
}

export type Workspace = {
  id: string
  name: string
  role: string
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.')
  }
  return data as T
}

export async function registerUser(payload: {
  name: string
  email: string
  password: string
  workspaceName: string
}): Promise<{ token: string; user: UserProfile; workspaces: Workspace[] }> {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return handleResponse(response)
}

export async function loginUser(payload: {
  email: string
  password: string
}): Promise<{ token: string; user: UserProfile; workspaces: Workspace[] }> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return handleResponse(response)
}

export async function getMe(token: string): Promise<{ user: UserProfile; workspaces: Workspace[] }> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { ...authHeaders(token) },
  })

  return handleResponse(response)
}

export async function createWorkspace(
  token: string,
  name: string,
): Promise<{ workspace: Workspace }> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ name }),
  })

  return handleResponse(response)
}

export async function indexKnowledgeFiles(
  token: string,
  workspaceId: string,
  files: FileList,
): Promise<{ indexed: number; failed: number; files: IndexedFileResult[] }> {
  const formData = new FormData()
  formData.append('workspaceId', workspaceId)

  Array.from(files).forEach((file) => {
    formData.append('files', file)
  })

  const response = await fetch(`${API_BASE_URL}/api/knowledge/index`, {
    method: 'POST',
    headers: { ...authHeaders(token) },
    body: formData,
  })

  return handleResponse(response)
}

export async function parseTenderFile(
  token: string,
  workspaceId: string,
  file: File,
): Promise<{ fileName: string; textLength: number; questions: string[] }> {
  const formData = new FormData()
  formData.append('workspaceId', workspaceId)
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/api/tender/parse`, {
    method: 'POST',
    headers: { ...authHeaders(token) },
    body: formData,
  })

  return handleResponse(response)
}

export async function generateDraft(
  token: string,
  workspaceId: string,
  questions: string[],
): Promise<{ workspaceId: string; draft: DraftQuestion[] }> {
  const response = await fetch(`${API_BASE_URL}/api/tender/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ workspaceId, questions }),
  })

  return handleResponse(response)
}
