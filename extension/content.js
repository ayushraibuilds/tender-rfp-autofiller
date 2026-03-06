function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isVisible(el) {
  const style = window.getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function getLabelText(element) {
  const id = element.getAttribute('id')
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`)
    if (label) {
      return label.textContent || ''
    }
  }

  const wrappingLabel = element.closest('label')
  if (wrappingLabel) {
    return wrappingLabel.textContent || ''
  }

  const parentText = element.closest('div,td,th,p')?.textContent || ''
  return parentText
}

function collectQuestions() {
  const fields = Array.from(
    document.querySelectorAll(
      'textarea, input[type="text"], input[type="search"], input[type="email"], input:not([type])',
    ),
  ).filter((field) => !field.disabled && !field.readOnly && isVisible(field))

  const questions = fields
    .map((field) => {
      const label = getLabelText(field)
      const placeholder = field.getAttribute('placeholder') || ''
      return `${label} ${placeholder}`.replace(/\s+/g, ' ').trim()
    })
    .filter((text) => text.length >= 12)

  return Array.from(new Set(questions)).slice(0, 120)
}

function fillFromDraft(draftItems) {
  const fields = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type])'))

  let filled = 0
  for (const field of fields) {
    const candidateText = `${getLabelText(field)} ${field.getAttribute('placeholder') || ''}`
    const normCandidate = normalize(candidateText)

    const match = draftItems.find((item) => {
      const q = normalize(item.question)
      return normCandidate.includes(q) || q.includes(normCandidate)
    })

    if (!match || !match.answer) {
      continue
    }

    field.value = match.answer
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    filled += 1
  }

  return filled
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TENDERPILOT_COLLECT_QUESTIONS') {
    sendResponse({ ok: true, questions: collectQuestions() })
    return
  }

  if (message?.type !== 'TENDERPILOT_FILL') {
    return
  }

  try {
    const items = Array.isArray(message.payload?.draft) ? message.payload.draft : []
    const filled = fillFromDraft(items)
    sendResponse({ ok: true, filled })
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Fill failed' })
  }
})
