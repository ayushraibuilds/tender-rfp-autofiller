const fillBtn = document.getElementById('fillBtn')
const draftJson = document.getElementById('draftJson')
const status = document.getElementById('status')

fillBtn.addEventListener('click', async () => {
  status.textContent = ''

  let parsed
  try {
    parsed = JSON.parse(draftJson.value || '{}')
  } catch {
    status.textContent = 'Invalid JSON format.'
    return
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    status.textContent = 'No active tab found.'
    return
  }

  chrome.tabs.sendMessage(tab.id, { type: 'TENDERPILOT_FILL', payload: parsed }, (response) => {
    if (chrome.runtime.lastError) {
      status.textContent = `Error: ${chrome.runtime.lastError.message}`
      return
    }

    if (!response?.ok) {
      status.textContent = response?.error || 'Filling failed.'
      return
    }

    status.textContent = `Filled ${response.filled} fields.`
  })
})
