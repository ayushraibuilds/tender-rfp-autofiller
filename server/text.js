import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

function normalizeForQuestions(input) {
  return input
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function normalizeForChunks(input) {
  return input.replace(/\s+/g, ' ').trim()
}

function chunkText(text, maxChars = 1200, overlap = 200) {
  const cleaned = normalizeForChunks(text)
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

async function extractTextFromSheetBuffer(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const parts = []
  workbook.eachSheet((sheet) => {
    const rows = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values
        .slice(1)
        .map((cell) => String(cell ?? '').trim())
        .filter(Boolean)
      if (values.length > 0) {
        rows.push(values.join(' | '))
      }
    })

    if (rows.length > 0) {
      parts.push(`Sheet: ${sheet.name}\n${rows.join('\n')}`)
    }
  })

  return parts.join('\n\n')
}

export async function extractTextFromUpload(file) {
  const fileName = file.originalname.toLowerCase()
  const mime = file.mimetype

  if (fileName.endsWith('.pdf') || mime === 'application/pdf') {
    const parsed = await pdfParse(file.buffer)
    return normalizeForQuestions(parsed.text || '')
  }

  if (
    fileName.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer })
    return normalizeForQuestions(parsed.value || '')
  }

  if (
    fileName.endsWith('.xlsx') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return normalizeForQuestions(await extractTextFromSheetBuffer(file.buffer))
  }

  if (fileName.endsWith('.txt') || mime.startsWith('text/')) {
    return normalizeForQuestions(file.buffer.toString('utf8'))
  }

  if (fileName.endsWith('.doc')) {
    throw new Error('Legacy .doc format is not supported. Please upload .docx.')
  }

  throw new Error('Unsupported file type. Use PDF, DOCX, XLSX, or TXT.')
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
    if (/^(scope|deliverable|timeline|security|pricing|support|experience|question|requirement)\b/i.test(line)) {
      return true
    }
    return false
  })

  return Array.from(
    new Set(questionCandidates.map((line) => line.replace(/^\d+[.)]\s+/, '').trim())),
  ).filter((line) => line.length >= 20)
}

export { chunkText }
