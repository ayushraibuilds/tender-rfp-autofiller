import OpenAI from 'openai'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const FALLBACK_DIMENSIONS = 256

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function hashToken(token) {
  let hash = 0
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash << 5) - hash + token.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function normalize(vec) {
  const magnitude = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude) {
    return vec
  }
  return vec.map((value) => value / magnitude)
}

function fallbackEmbedOne(text) {
  const vector = new Array(FALLBACK_DIMENSIONS).fill(0)
  const tokens = tokenize(text)

  for (const token of tokens) {
    const index = hashToken(token) % FALLBACK_DIMENSIONS
    vector[index] += 1
  }

  return normalize(vector)
}

export async function embedTexts(texts) {
  const sanitized = texts.map((text) => text.trim()).filter(Boolean)
  if (sanitized.length === 0) {
    return []
  }

  if (!openai) {
    return sanitized.map((text) => fallbackEmbedOne(text))
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: sanitized,
  })

  return response.data.map((item) => item.embedding)
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    return 0
  }

  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  if (!magA || !magB) {
    return 0
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export function isUsingOpenAIEmbeddings() {
  return Boolean(openai)
}
