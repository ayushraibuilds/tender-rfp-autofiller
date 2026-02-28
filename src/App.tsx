import { useMemo, useState } from 'react'
import './App.css'

type Page = 'dashboard' | 'knowledge' | 'tender' | 'review'

type UploadedDoc = {
  id: string
  name: string
  sizeLabel: string
  addedAt: string
}

type DraftQuestion = {
  id: string
  question: string
  answer: string
  confidence: number
  status: 'ready' | 'needs-attention'
  source: string
}

const TENDER_QUESTIONS = [
  { id: 'q1', text: 'Provide company profile and years of experience.' },
  { id: 'q2', text: 'Describe your information security policy and certifications.' },
  { id: 'q3', text: 'Share 2 relevant case studies with outcomes and client type.' },
  { id: 'q4', text: 'Confirm delivery timeline, milestones, and support model.' },
  { id: 'q5', text: 'State pricing assumptions, payment terms, and validity.' },
]

const keywordConfig = [
  {
    key: 'company profile',
    match: ['profile', 'about', 'experience', 'years'],
    answer:
      'Our company profile and experience summary are aligned with similar bids. We can provide complete legal details, GST information, and team structure in the annexure.',
    source: 'Company profile library',
  },
  {
    key: 'security',
    match: ['security', 'iso', 'policy', 'infosec'],
    answer:
      'We maintain a documented information security policy, role-based access controls, encrypted data handling, and periodic internal review procedures. Certification details can be attached as required.',
    source: 'Security policy library',
  },
  {
    key: 'case studies',
    match: ['case', 'study', 'outcomes', 'client'],
    answer:
      'We have delivered comparable projects with measurable outcomes such as reduced turnaround time, better compliance tracking, and improved operational visibility. Detailed references are available upon request.',
    source: 'Past winning proposals',
  },
  {
    key: 'timeline',
    match: ['timeline', 'milestone', 'support', 'delivery'],
    answer:
      'Our standard approach includes kickoff, requirement validation, phased delivery milestones, UAT, and post-go-live support with clear escalation paths.',
    source: 'Delivery framework docs',
  },
  {
    key: 'pricing',
    match: ['pricing', 'payment', 'terms', 'validity'],
    answer:
      'Commercial terms are provided as milestone-based pricing with clear assumptions, invoicing schedule, and proposal validity period as per tender format.',
    source: 'Commercial templates',
  },
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

function buildDraft(knowledgeText: string): DraftQuestion[] {
  const corpus = knowledgeText.toLowerCase()

  return TENDER_QUESTIONS.map((item) => {
    const matchedConfig = keywordConfig.find((config) =>
      config.match.some((token) => item.text.toLowerCase().includes(token)),
    )

    const isQuestionCovered = matchedConfig?.match.some((token) =>
      corpus.includes(token),
    )

    const confidence = isQuestionCovered ? 0.86 : 0.41

    return {
      id: item.id,
      question: item.text,
      answer: isQuestionCovered
        ? matchedConfig?.answer ??
          'Drafted from your historical knowledge base. Please review final wording.'
        : 'New question detected. Add specific project context, exact numbers, and supporting evidence before submission.',
      confidence,
      status: confidence >= 0.75 ? 'ready' : 'needs-attention',
      source: isQuestionCovered
        ? matchedConfig?.source ?? 'Knowledge base'
        : 'No strong match found',
    }
  })
}

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('IT Services')
  const [knowledgeNotes, setKnowledgeNotes] = useState('')
  const [knowledgeDocs, setKnowledgeDocs] = useState<UploadedDoc[]>([])
  const [tenderDoc, setTenderDoc] = useState<UploadedDoc | null>(null)
  const [draft, setDraft] = useState<DraftQuestion[]>([])

  const onboardingDone = companyName.trim().length > 0 && knowledgeDocs.length > 0

  const readyCount = draft.filter((item) => item.status === 'ready').length
  const needsAttentionCount = draft.filter((item) => item.status === 'needs-attention').length

  const sidebarItems: Array<{ id: Page; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'knowledge', label: 'Knowledge Base' },
    { id: 'tender', label: 'New Tender' },
    { id: 'review', label: 'AI Draft Review' },
  ]

  const knowledgeCorpus = useMemo(() => {
    const docNames = knowledgeDocs.map((doc) => doc.name).join(' ')
    return `${docNames} ${knowledgeNotes}`
  }, [knowledgeDocs, knowledgeNotes])

  const addKnowledgeDocs = (files: FileList | null): void => {
    if (!files) {
      return
    }
    const nextDocs = Array.from(files).map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      sizeLabel: formatBytes(file.size),
      addedAt: new Date().toLocaleDateString(),
    }))
    setKnowledgeDocs((prev) => [...prev, ...nextDocs])
  }

  const setTenderFile = (files: FileList | null): void => {
    const file = files?.[0]
    if (!file) {
      return
    }
    setTenderDoc({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      sizeLabel: formatBytes(file.size),
      addedAt: new Date().toLocaleDateString(),
    })
  }

  const runAutofill = (): void => {
    if (!tenderDoc) {
      return
    }
    const result = buildDraft(knowledgeCorpus)
    setDraft(result)
    setPage('review')
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
        {page === 'dashboard' && (
          <section>
            <header className="header-row">
              <div>
                <h2>Welcome{companyName ? `, ${companyName}` : ''}</h2>
                <p>Complete the 3-step setup, then let AI draft your next tender response.</p>
              </div>
            </header>

            <div className="grid-cards">
              <article className="card">
                <h3>Step 1: Company Setup</h3>
                <label>
                  Company name
                  <input
                    placeholder="Enter your company"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                  />
                </label>
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
              </article>

              <article className="card">
                <h3>Step 2: Upload Winning Proposals</h3>
                <p>{knowledgeDocs.length} files uploaded</p>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  multiple
                  onChange={(event) => addKnowledgeDocs(event.target.files)}
                />
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
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(event) => setTenderFile(event.target.files)}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={runAutofill}
                  disabled={!onboardingDone || !tenderDoc}
                >
                  Generate AI Draft
                </button>
              </article>
            </div>

            <section className="stats-row">
              <article className="stat">
                <h4>Knowledge Files</h4>
                <p>{knowledgeDocs.length}</p>
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
                <p>Upload old winning proposals and policy documents once. Reuse forever.</p>
              </div>
            </header>

            <div className="grid-cards two-col">
              <article className="card">
                <h3>Add Documents</h3>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(event) => addKnowledgeDocs(event.target.files)}
                />
                <label>
                  Quick notes (optional)
                  <textarea
                    placeholder="Paste company profile, certifications, key case studies, standard delivery timelines..."
                    value={knowledgeNotes}
                    onChange={(event) => setKnowledgeNotes(event.target.value)}
                  />
                </label>
              </article>

              <article className="card">
                <h3>Uploaded Library</h3>
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
                        </div>
                        <span className="chip ready">Indexed</span>
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
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(event) => setTenderFile(event.target.files)}
              />
              <p>{tenderDoc ? `${tenderDoc.name} (${tenderDoc.sizeLabel})` : 'No file selected'}</p>
              <button
                type="button"
                className="primary"
                onClick={runAutofill}
                disabled={!onboardingDone || !tenderDoc}
              >
                Run AI Auto-Fill
              </button>
              {!onboardingDone && (
                <small>
                  Add company name and upload at least one winning proposal before running AI.
                </small>
              )}
            </article>
          </section>
        )}

        {page === 'review' && (
          <section>
            <header className="header-row">
              <div>
                <h2>AI Draft Review</h2>
                <p>
                  Review high-confidence answers quickly. Focus only on questions marked
                  "Needs Attention".
                </p>
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
                      <h3>{item.question}</h3>
                      <span
                        className={
                          item.status === 'ready' ? 'chip ready' : 'chip attention'
                        }
                      >
                        {item.status === 'ready' ? 'Ready' : 'Needs Attention'}
                      </span>
                    </div>
                    <p>{item.answer}</p>
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
