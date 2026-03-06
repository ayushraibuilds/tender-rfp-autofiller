const fillBtn = document.getElementById('fillBtn')
const generateFillBtn = document.getElementById('generateFillBtn')
const saveBtn = document.getElementById('saveBtn')
const draftJson = document.getElementById('draftJson')
const apiBaseUrlInput = document.getElementById('apiBaseUrl')
const tokenInput = document.getElementById('token')
const workspaceIdInput = document.getElementById('workspaceId')
const status = document.getElementById('status')

function setStatus(message) {
  status.textContent = message
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    throw new Error('No active tab found.')
  }
  return tab
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab()
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response)
    })
  })
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(['apiBaseUrl', 'token', 'workspaceId'])
  apiBaseUrlInput.value = stored.apiBaseUrl || 'http://localhost:8787'
  tokenInput.value = stored.token || ''
  workspaceIdInput.value = stored.workspaceId || ''
}

async function saveConfig() {
  const payload = {
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    token: tokenInput.value.trim(),
    workspaceId: workspaceIdInput.value.trim(),
  }
  await chrome.storage.local.set(payload)
}

async function fillWithPayload(payload) {
  const response = await sendToActiveTab({ type: 'TENDERPILOT_FILL', payload })
  if (!response?.ok) {
    throw new Error(response?.error || 'Filling failed.')
  }
  setStatus(`Filled ${response.filled} fields.`)
}

fillBtn.addEventListener('click', async () => {
  setStatus('')

  let parsed
  try {
    parsed = JSON.parse(draftJson.value || '{}')
  } catch {
    setStatus('Invalid JSON format.')
    return
  }

  try {
    await fillWithPayload(parsed)
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : 'Fill failed.'}`)
  }
})

saveBtn.addEventListener('click', async () => {
  try {
    await saveConfig()
    setStatus('Config saved.')
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : 'Save failed.'}`)
  }
})

generateFillBtn.addEventListener('click', async () => {
  setStatus('Collecting questions from page...')

  try {
    await saveConfig()

    const apiBaseUrl = apiBaseUrlInput.value.trim().replace(/\/$/, '')
    const token = tokenInput.value.trim()
    const workspaceId = workspaceIdInput.value.trim()

    if (!apiBaseUrl || !token || !workspaceId) {
      setStatus('API URL, token, and workspace ID are required.')
      return
    }

    const collect = await sendToActiveTab({ type: 'TENDERPILOT_COLLECT_QUESTIONS' })
    const questions = Array.isArray(collect?.questions) ? collect.questions : []

    if (questions.length === 0) {
      setStatus('No fillable questions detected on this page.')
      return
    }

    setStatus(`Generating answers for ${questions.length} questions...`)
    const response = await fetch(`${apiBaseUrl}/api/tender/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ workspaceId, questions }),
    })

    const body = await response.json()
    if (!response.ok) {
      throw new Error(body.error || 'Draft generation failed.')
    }

    if (!Array.isArray(body.draft) || body.draft.length === 0) {
      throw new Error('No draft answers returned by API.')
    }

    await fillWithPayload({ draft: body.draft })
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : 'Generate + fill failed.'}`)
  }
})

void loadConfig()
