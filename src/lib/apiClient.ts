const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787'

export type IndexedFileResult = {
  fileName: string
  sourcePath?: string
  status: 'indexed' | 'failed'
  version?: number
  chunkCount?: number
  extractedChars?: number
  error?: string
}

export type DraftQuestion = {
  id: string
  question: string
  answer: string
  confidence: number
  band?: 'green' | 'yellow' | 'red'
  status: 'ready' | 'needs-attention'
  source: string
  citations?: Array<{
    source: string
    snippet: string
    score: number
  }>
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
  plan?: 'free' | 'pro' | 'team'
  tenderUsage?: {
    month: string
    used: number
    limit: number | null
    remaining: number | null
  }
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
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    formData.append('sourcePath', relativePath && relativePath.length > 0 ? relativePath : file.name)
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
  useLastQuarter = false,
): Promise<{
  workspaceId: string
  draft: DraftQuestion[]
  plan?: 'free' | 'pro' | 'team'
  tenderUsage?: {
    month: string
    used: number
    limit: number | null
    remaining: number | null
  }
}> {
  const response = await fetch(`${API_BASE_URL}/api/tender/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ workspaceId, questions, useLastQuarter }),
  })

  return handleResponse(response)
}

export async function exportDraft(
  token: string,
  workspaceId: string,
  draft: DraftQuestion[],
  format: 'xlsx' | 'pdf',
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/tender/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ workspaceId, draft, format }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Export failed.')
  }

  return response.blob()
}

export async function exportFilledExcel(
  token: string,
  workspaceId: string,
  originalTenderFile: File,
  draft: DraftQuestion[],
): Promise<Blob> {
  const formData = new FormData()
  formData.append('workspaceId', workspaceId)
  formData.append('file', originalTenderFile)
  formData.append('draft', JSON.stringify(draft))

  const response = await fetch(`${API_BASE_URL}/api/tender/export-filled`, {
    method: 'POST',
    headers: { ...authHeaders(token) },
    body: formData,
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Filled excel export failed.')
  }

  return response.blob()
}

export async function exportPortalFormat(
  token: string,
  workspaceId: string,
  draft: DraftQuestion[],
  format: 'json' | 'xml',
  platform: 'coupa' | 'ariba' | 'jaggaer' | 'generic',
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/tender/export-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ workspaceId, draft, format, platform }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Portal export failed.')
  }

  if (format === 'json') {
    const payload = await response.json()
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  }

  return response.blob()
}

export async function askClarifyingQuestions(
  token: string,
  workspaceId: string,
  draft: DraftQuestion[],
): Promise<{ clarifications: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/tender/clarify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ workspaceId, draft }),
  })

  return handleResponse(response)
}

export async function getIndiaTemplates(
  token: string,
): Promise<{ templates: Array<{ id: string; title: string; body: string }> }> {
  const response = await fetch(`${API_BASE_URL}/api/templates/india`, {
    headers: { ...authHeaders(token) },
  })

  return handleResponse(response)
}

export async function getWorkspaceUsage(
  token: string,
  workspaceId: string,
): Promise<{
  workspaceId: string
  plan: 'free' | 'pro' | 'team'
  tenderUsage: { month: string; used: number; limit: number | null; remaining: number | null }
  features: { filledExcelExport: boolean }
}> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/usage`, {
    headers: { ...authHeaders(token) },
  })

  return handleResponse(response)
}

export async function updateWorkspacePlan(
  token: string,
  workspaceId: string,
  plan: 'free' | 'pro' | 'team',
): Promise<{
  workspaceId: string
  plan: 'free' | 'pro' | 'team'
  tenderUsage: { month: string; used: number; limit: number | null; remaining: number | null }
}> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ plan }),
  })

  return handleResponse(response)
}
