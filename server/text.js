import mammoth from 'mammoth'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

function cleanText(input) {
  return input.replace(/\s+/g, ' ').trim()
}

function chunkText(text, maxChars = 1200, overlap = 200) {
  const cleaned = cleanText(text)
  if (!cleaned) {
    return []
  }

  const chunks = []
  let start = 0

  while (start < cleaned.length) {
    const end = Math.min(start + maxChars, cleaned.length)
    const chunk = cleaned.slice(start, end).trim()
    if (chunk.length > 80) {
      chunks.push(chunk)
    }

    if (end >= cleaned.length) {
      break
    }

    start = Math.max(end - overlap, start + 1)
  }

  return chunks
}

export async function extractTextFromUpload(file) {
  const fileName = file.originalname.toLowerCase()
  const mime = file.mimetype

  if (fileName.endsWith('.pdf') || mime === 'application/pdf') {
    const parsed = await pdfParse(file.buffer)
    return cleanText(parsed.text)
  }

  if (
    fileName.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer })
    return cleanText(parsed.value)
  }

  if (fileName.endsWith('.txt') || mime.startsWith('text/')) {
    return cleanText(file.buffer.toString('utf8'))
  }

  if (fileName.endsWith('.doc')) {
    throw new Error('Legacy .doc format is not supported. Please upload .docx.')
  }

  throw new Error('Unsupported file type. Use PDF, DOCX, or TXT.')
}

export function extractQuestions(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const questionCandidates = lines.filter((line) => {
    if (line.endsWith('?')) {
      return true
    }
    if (/^\d+[.)]\s+/.test(line)) {
      return true
    }
    if (/^(scope|deliverable|timeline|security|pricing|support|experience)\b/i.test(line)) {
      return true
    }
    return false
  })

  return Array.from(new Set(questionCandidates.map((line) => line.replace(/^\d+[.)]\s+/, '').trim()))).filter(
    (line) => line.length >= 20,
  )
}

export { chunkText }
