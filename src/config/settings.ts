import 'dotenv/config';
const number = (name: string, fallback: number, min = 1) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min) throw new Error(`Configuração inválida: ${name}`);
  return value;
};
export const settings = {
  port: number('PORT', 3333),
  trustProxyHops: number('TRUST_PROXY_HOPS', 0, 0),
  groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  embeddingModel: process.env.EMBEDDING_MODEL || 'bge-m3',
  embeddingDimensions: number('EMBEDDING_DIMENSIONS', 1024),
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  collection: process.env.QDRANT_COLLECTION || 'legislacao_visa',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  requestTimeoutMs: number('REQUEST_TIMEOUT_MS', 120000),
  chatTimeoutMs: number('CHAT_TIMEOUT_MS', 180000),
  searchLimit: number('SEARCH_LIMIT', 6),
  searchThreshold: number('SEARCH_SCORE_THRESHOLD', 0.3, 0),
  maxHistoryTokens: number('MAX_HISTORY_TOKENS', 5000),
  maxResponseTokens: number('MAX_RESPONSE_TOKENS', 1000),
  uploadMaxBytes: number('UPLOAD_MAX_BYTES', 25 * 1024 * 1024),
  workerLeaseMs: number('WORKER_LEASE_MS', 30000),
  workerPollMs: number('WORKER_POLL_MS', 1000),
  conversationTtlMs: number('CONVERSATION_TTL_MS', 24 * 60 * 60 * 1000),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
};
