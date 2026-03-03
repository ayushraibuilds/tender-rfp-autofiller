import { useEffect, useMemo, useState, type DragEvent } from 'react'
import './App.css'
import {
  createWorkspace,
  exportDraft,
  generateDraft,
  getMe,
  indexKnowledgeFiles,
  loginUser,
  parseTenderFile,
  registerUser,
  type DraftQuestion,
  type UserProfile,
  type Workspace,
} from './lib/apiClient'

type Page = 'dashboard' | 'knowledge' | 'tender' | 'review'
type AuthMode = 'login' | 'register'
type ParseStatus = 'indexed' | 'failed'

type UploadedDoc = {
  id: string
  name: string
  sourcePath?: string
  sizeLabel: string
  addedAt: string
  parseStatus: ParseStatus
  version?: number
  parseError?: string
  chunkCount?: number
}

const TOKEN_KEY = 'tenderpilot_token'

const FALLBACK_TENDER_QUESTIONS = [
  'Provide company profile and years of experience.',
  'Describe your information security policy and certifications.',
  'Share 2 relevant case studies with outcomes and client type.',
  'Confirm delivery timeline, milestones, and support model.',
  'State pricing assumptions, payment terms, and validity.',
]

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authWorkspaceName, setAuthWorkspaceName] = useState('')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(true)

  const [page, setPage] = useState<Page>('dashboard')
  const [industry, setIndustry] = useState('IT Services')
  const [knowledgeNotes, setKnowledgeNotes] = useState('')
  const [knowledgeDocs, setKnowledgeDocs] = useState<UploadedDoc[]>([])
  const [tenderDoc, setTenderDoc] = useState<UploadedDoc | null>(null)
  const [tenderQuestions, setTenderQuestions] = useState<string[]>([])
  const [draft, setDraft] = useState<DraftQuestion[]>([])
  const [isIndexingKnowledge, setIsIndexingKnowledge] = useState(false)
  const [isParsingTender, setIsParsingTender] = useState(false)
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false)
  const [isExportingDraft, setIsExportingDraft] = useState(false)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const bootstrap = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY)
      if (!storedToken) {
        setIsLoadingSession(false)
        return
      }

      try {
        const me = await getMe(storedToken)
        setToken(storedToken)
        setUser(me.user)
        setWorkspaces(me.workspaces)
        setSelectedWorkspaceId(me.workspaces[0]?.id || '')
      } catch {
        localStorage.removeItem(TOKEN_KEY)
      } finally {
        setIsLoadingSession(false)
      }
    }

    void bootstrap()
  }, [])

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [workspaces, selectedWorkspaceId],
  )

  const indexedKnowledgeCount = knowledgeDocs.filter(
    (doc) => doc.parseStatus === 'indexed',
  ).length
  const failedKnowledgeCount = knowledgeDocs.filter(
    (doc) => doc.parseStatus === 'failed',
  ).length

  const onboardingDone = Boolean(selectedWorkspaceId) && indexedKnowledgeCount > 0

  const readyCount = draft.filter((item) => item.status === 'ready').length
  const needsAttentionCount = draft.filter((item) => item.status === 'needs-attention').length

  const sidebarItems: Array<{ id: Page; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'knowledge', label: 'Knowledge Base' },
    { id: 'tender', label: 'New Tender' },
    { id: 'review', label: 'AI Draft Review' },
  ]

  const clearWorkspaceData = () => {
    setKnowledgeDocs([])
    setTenderDoc(null)
    setTenderQuestions([])
    setDraft([])
    setKnowledgeNotes('')
  }

  const handleDropKnowledge = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    void addKnowledgeDocs(event.dataTransfer.files)
  }

  const handleDropTender = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    void setTenderFile(event.dataTransfer.files)
  }

  const persistSession = (sessionToken: string, profile: UserProfile, nextWorkspaces: Workspace[]) => {
    localStorage.setItem(TOKEN_KEY, sessionToken)
    setToken(sessionToken)
    setUser(profile)
    setWorkspaces(nextWorkspaces)
    setSelectedWorkspaceId(nextWorkspaces[0]?.id || '')
    clearWorkspaceData()
  }

  const handleAuth = async () => {
    setErrorMessage('')
    setIsAuthenticating(true)

    try {
      if (authMode === 'login') {
        const result = await loginUser({ email: authEmail, password: authPassword })
        persistSession(result.token, result.user, result.workspaces)
      } else {
        const result = await registerUser({
          name: authName,
          email: authEmail,
          password: authPassword,
          workspaceName: authWorkspaceName,
        })
        persistSession(result.token, result.user, result.workspaces)
      }
      setAuthPassword('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleCreateWorkspace = async () => {
    if (!token || !newWorkspaceName.trim()) {
      return
    }

    setErrorMessage('')
    setIsCreatingWorkspace(true)

    try {
      const result = await createWorkspace(token, newWorkspaceName)
      const nextWorkspaces = [result.workspace, ...workspaces]
      setWorkspaces(nextWorkspaces)
      setSelectedWorkspaceId(result.workspace.id)
      setNewWorkspaceName('')
      clearWorkspaceData()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create workspace.')
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    setWorkspaces([])
    setSelectedWorkspaceId('')
    clearWorkspaceData()
  }

  const addKnowledgeDocs = async (files: FileList | null): Promise<void> => {
    if (!token || !selectedWorkspaceId || !files || files.length === 0) {
      return
    }

    setErrorMessage('')
    setIsIndexingKnowledge(true)

    try {
      const result = await indexKnowledgeFiles(token, selectedWorkspaceId, files)
      const uploadedAt = new Date().toLocaleDateString()
      const docs: UploadedDoc[] = result.files.map((item) => {
        const originalFile = Array.from(files).find((file) => file.name === item.fileName)
        return {
          id: `${item.fileName}-${Math.random().toString(36).slice(2)}`,
          name: item.fileName,
          sourcePath: item.sourcePath,
          sizeLabel: originalFile ? formatBytes(originalFile.size) : 'Unknown size',
          addedAt: uploadedAt,
          parseStatus: item.status,
          version: item.version,
          parseError: item.error,
          chunkCount: item.chunkCount,
        }
      })

      setKnowledgeDocs((prev) => [...prev, ...docs])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not index knowledge files.')
    } finally {
      setIsIndexingKnowledge(false)
    }
  }

  const setTenderFile = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!token || !selectedWorkspaceId || !file) {
      return
    }

    setErrorMessage('')
    setIsParsingTender(true)

    const base = {
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      sizeLabel: formatBytes(file.size),
      addedAt: new Date().toLocaleDateString(),
    }

    try {
      const parsed = await parseTenderFile(token, selectedWorkspaceId, file)
      setTenderDoc({ ...base, parseStatus: 'indexed' })
      setTenderQuestions(
        parsed.questions.length > 0 ? parsed.questions : FALLBACK_TENDER_QUESTIONS,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Parsing failed.'
      setTenderDoc({ ...base, parseStatus: 'failed', parseError: message })
      setTenderQuestions([])
      setErrorMessage(message)
    } finally {
      setIsParsingTender(false)
    }
  }

  const runAutofill = async (): Promise<void> => {
    if (!token || !selectedWorkspaceId || !tenderDoc || tenderDoc.parseStatus === 'failed') {
      return
    }

    setErrorMessage('')
    setIsGeneratingDraft(true)

    try {
      const questions = tenderQuestions.length > 0 ? tenderQuestions : FALLBACK_TENDER_QUESTIONS
      const result = await generateDraft(token, selectedWorkspaceId, questions)
      setDraft(result.draft)
      setPage('review')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate draft.')
    } finally {
      setIsGeneratingDraft(false)
    }
  }

  const handleExportDraft = async (format: 'xlsx' | 'pdf') => {
    if (!token || !selectedWorkspaceId || draft.length === 0) {
      return
    }

    setErrorMessage('')
    setIsExportingDraft(true)
    try {
      const blob = await exportDraft(token, selectedWorkspaceId, draft, format)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = format === 'pdf' ? 'tender-draft.pdf' : 'tender-draft.xlsx'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setIsExportingDraft(false)
    }
  }

  if (isLoadingSession) {
    return <main className="auth-shell">Loading workspace...</main>
  }

  if (!token || !user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>TenderPilot AI</h1>
          <p>Secure workspace login for your bidding team.</p>

          {errorMessage && <p className="error-banner">{errorMessage}</p>}

          <div className="auth-tabs">
            <button
              type="button"
              className={authMode === 'login' ? 'nav-item active' : 'nav-item'}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === 'register' ? 'nav-item active' : 'nav-item'}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
          </div>

          {authMode === 'register' && (
            <label>
              Full name
              <input value={authName} onChange={(event) => setAuthName(event.target.value)} />
            </label>
          )}

          <label>
            Email
            <input
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
            />
          </label>

          {authMode === 'register' && (
            <label>
              First workspace name
              <input
                placeholder="Example: Acme Bidding Team"
                value={authWorkspaceName}
                onChange={(event) => setAuthWorkspaceName(event.target.value)}
              />
            </label>
          )}

          <button type="button" className="primary" onClick={() => void handleAuth()}>
            {isAuthenticating
              ? 'Please wait...'
              : authMode === 'login'
                ? 'Login'
                : 'Create Account'}
          </button>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>TenderPilot AI</h1>
        <p className="subtitle">Faster tender responses for small teams</p>
        <nav>
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              className={page === item.id ? 'nav-item active' : 'nav-item'}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <div className="workspace-controls">
            <select
              value={selectedWorkspaceId}
              onChange={(event) => {
                setSelectedWorkspaceId(event.target.value)
                clearWorkspaceData()
              }}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <input
              placeholder="New workspace"
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => void handleCreateWorkspace()}
              disabled={isCreatingWorkspace}
            >
              {isCreatingWorkspace ? 'Creating...' : 'Create'}
            </button>
            <button type="button" className="secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        {errorMessage && <p className="error-banner">{errorMessage}</p>}

        {page === 'dashboard' && (
          <section>
            <header className="header-row">
              <div>
                <h2>{selectedWorkspace?.name || 'Workspace'}</h2>
                <p>Upload knowledge, parse tender docs, and draft responses securely.</p>
              </div>
            </header>

            <div className="grid-cards">
              <article className="card">
                <h3>Step 1: Workspace Profile</h3>
                <label>
                  Industry
                  <select
                    value={industry}
                    onChange={(event) => setIndustry(event.target.value)}
                  >
                    <option>IT Services</option>
                    <option>Construction</option>
                    <option>Creative Agency</option>
                    <option>Other</option>
                  </select>
                </label>
                <small>All data is isolated to this selected workspace.</small>
              </article>

              <article className="card">
                <h3>Step 2: Upload Winning Proposals</h3>
                <p>{knowledgeDocs.length} files uploaded</p>
                <div
                  className="dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropKnowledge}
                >
                  <p>Drag and drop files/folders here, or browse.</p>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xlsx,.txt"
                    multiple
                    onChange={(event) => {
                      void addKnowledgeDocs(event.target.files)
                    }}
                  />
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
                    onChange={(event) => {
                      void addKnowledgeDocs(event.target.files)
                    }}
                  />
                </div>
                {isIndexingKnowledge && <small>Indexing documents in vector store...</small>}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPage('knowledge')}
                >
                  Manage Knowledge Base
                </button>
              </article>

              <article className="card">
                <h3>Step 3: Upload New Tender</h3>
                <p>{tenderDoc ? tenderDoc.name : 'No tender selected yet'}</p>
                <div
                  className="dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropTender}
                >
                  <p>Drag and drop the tender file, or browse.</p>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xlsx"
                    onChange={(event) => {
                      void setTenderFile(event.target.files)
                    }}
                  />
                </div>
                {isParsingTender && <small>Parsing tender file...</small>}
                {tenderDoc?.parseStatus === 'failed' && (
                  <small>Could not parse this file: {tenderDoc.parseError}</small>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    void runAutofill()
                  }}
                  disabled={
                    !onboardingDone ||
                    !tenderDoc ||
                    tenderDoc.parseStatus === 'failed' ||
                    isParsingTender ||
                    isGeneratingDraft
                  }
                >
                  {isGeneratingDraft ? 'Generating Draft...' : 'Generate AI Draft'}
                </button>
              </article>
            </div>

            <section className="stats-row">
              <article className="stat">
                <h4>Indexed Knowledge Files</h4>
                <p>{indexedKnowledgeCount}</p>
              </article>
              <article className="stat">
                <h4>Draft Ready Answers</h4>
                <p>{readyCount}</p>
              </article>
              <article className="stat warning">
                <h4>Needs Attention</h4>
                <p>{needsAttentionCount}</p>
              </article>
            </section>
          </section>
        )}

        {page === 'knowledge' && (
          <section>
            <header className="header-row">
              <div>
                <h2>Knowledge Base</h2>
                <p>Upload winning proposals once per workspace. Reuse forever.</p>
              </div>
            </header>

            <div className="grid-cards two-col">
              <article className="card">
                <h3>Add Documents</h3>
                <div
                  className="dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropKnowledge}
                >
                  <p>Drop PDF, DOCX, XLSX, TXT files or whole folders.</p>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xlsx,.txt"
                    onChange={(event) => {
                      void addKnowledgeDocs(event.target.files)
                    }}
                  />
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
                    onChange={(event) => {
                      void addKnowledgeDocs(event.target.files)
                    }}
                  />
                </div>
                {isIndexingKnowledge && <small>Indexing documents in vector store...</small>}
                <label>
                  Quick notes (local)
                  <textarea
                    placeholder="Optional notes for your team's context."
                    value={knowledgeNotes}
                    onChange={(event) => setKnowledgeNotes(event.target.value)}
                  />
                </label>
              </article>

              <article className="card">
                <h3>Uploaded Library</h3>
                <p>
                  Indexed: {indexedKnowledgeCount} | Failed: {failedKnowledgeCount}
                </p>
                {knowledgeDocs.length === 0 ? (
                  <p>No files yet. Upload your first winning proposal.</p>
                ) : (
                  <ul className="doc-list">
                    {knowledgeDocs.map((doc) => (
                      <li key={doc.id}>
                        <div>
                          <strong>{doc.name}</strong>
                          <small>
                            {doc.sizeLabel} • Added {doc.addedAt}
                          </small>
                          {doc.sourcePath ? <small>Path: {doc.sourcePath}</small> : null}
                          {doc.version ? <small>Version: v{doc.version}</small> : null}
                          {doc.chunkCount ? <small>Chunks indexed: {doc.chunkCount}</small> : null}
                          {doc.parseError && <small>{doc.parseError}</small>}
                        </div>
                        <span
                          className={
                            doc.parseStatus === 'indexed' ? 'chip ready' : 'chip attention'
                          }
                        >
                          {doc.parseStatus === 'indexed' ? 'Indexed' : 'Parse Failed'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </section>
        )}

        {page === 'tender' && (
          <section>
            <header className="header-row">
              <div>
                <h2>New Tender Intake</h2>
                <p>Upload incoming tender and generate a first draft in minutes.</p>
              </div>
            </header>

            <article className="card single-card">
              <h3>Tender File</h3>
              <div
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDropTender}
              >
                <p>Drop tender PDF/DOCX/XLSX here.</p>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xlsx"
                  onChange={(event) => {
                    void setTenderFile(event.target.files)
                  }}
                />
              </div>
              <p>{tenderDoc ? `${tenderDoc.name} (${tenderDoc.sizeLabel})` : 'No file selected'}</p>
              {isParsingTender && <small>Parsing tender file...</small>}
              {tenderDoc?.parseStatus === 'indexed' && (
                <small>Parsed questions detected: {tenderQuestions.length}</small>
              )}
              {tenderDoc?.parseStatus === 'failed' && (
                <small>Could not parse this file: {tenderDoc.parseError}</small>
              )}
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void runAutofill()
                }}
                disabled={
                  !onboardingDone ||
                  !tenderDoc ||
                  tenderDoc.parseStatus === 'failed' ||
                  isParsingTender ||
                  isGeneratingDraft
                }
              >
                {isGeneratingDraft ? 'Generating Draft...' : 'Run AI Auto-Fill'}
              </button>
            </article>
          </section>
        )}

        {page === 'review' && (
          <section>
            <header className="header-row">
              <div>
                <h2>AI Draft Review</h2>
                <p>
                  Answers are generated from retrieved chunks in the selected workspace. Review
                  only items marked "Needs Attention".
                </p>
              </div>
              <div className="review-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleExportDraft('xlsx')}
                  disabled={isExportingDraft || draft.length === 0}
                >
                  Export XLSX
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleExportDraft('pdf')}
                  disabled={isExportingDraft || draft.length === 0}
                >
                  Export PDF
                </button>
              </div>
            </header>

            {draft.length === 0 ? (
              <article className="card single-card">
                <h3>No draft yet</h3>
                <p>Upload a tender and click "Run AI Auto-Fill".</p>
              </article>
            ) : (
              <div className="draft-list">
                {draft.map((item) => (
                  <article className="card" key={item.id}>
                    <div className="question-head">
                      <h3>Q: {item.question}</h3>
                      <span
                        className={
                          item.status === 'ready' ? 'chip ready' : 'chip attention'
                        }
                      >
                        {item.status === 'ready' ? 'Ready' : 'Needs Attention'}
                      </span>
                    </div>
                    <div className="qa-grid">
                      <div>
                        <h4>Original Question</h4>
                        <p>{item.question}</p>
                      </div>
                      <div>
                        <h4>AI Draft Answer</h4>
                        <p>{item.answer}</p>
                      </div>
                    </div>
                    <div className="confidence-wrap" aria-label="confidence">
                      <div
                        className="confidence-bar"
                        style={{ width: `${Math.round(item.confidence * 100)}%` }}
                      />
                    </div>
                    <footer className="meta-row">
                      <small>Confidence: {Math.round(item.confidence * 100)}%</small>
                      <small>Source: {item.source}</small>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default App
