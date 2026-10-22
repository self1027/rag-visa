import 'dotenv/config';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
export function readSettings(env: NodeJS.ProcessEnv = process.env) {
  const number = (name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER, integer = true) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error(`Configuração inválida: ${name}`);
    return value;
  };
  const settings = {
    databasePath: env.DATABASE_PATH || path.resolve('data/database.sqlite'),
    pdfDir: path.resolve(env.PDF_DIR || 'data/pdfs'),
    ingestionWorkerInApi: env.INGESTION_WORKER_IN_API !== 'false',
    port: number('PORT', 3333, 1, 65535),
    trustProxyHops: number('TRUST_PROXY_HOPS', 0, 0),
    llmModel: env.LLM_MODEL || env.GROQ_MODEL || '',
    llmBaseUrl: env.LLM_BASE_URL || env.GROQ_BASE_URL || '',
    llmApiKey: env.LLM_API_KEY || env.GROQ_API_KEY || '',
    llmMaxRetries: number('LLM_MAX_RETRIES', 1, 0),
    embeddingModel: env.EMBEDDING_MODEL || '',
    embeddingProvider: env.EMBEDDING_PROVIDER || 'ollama',
    embeddingUrl: env.EMBEDDING_URL || 'http://localhost:8001',
    embeddingRevision: env.EMBEDDING_REVISION || '',
    embeddingQueryPrefix: env.EMBEDDING_QUERY_PREFIX || '',
    embeddingDocumentPrefix: env.EMBEDDING_DOCUMENT_PREFIX || '',
    embeddingContextTokens: number('EMBEDDING_CONTEXT_TOKENS', 8192),
    ingestionBatchSize: number('INGESTION_BATCH_SIZE', 25),
    chunkMaxLength: number('CHUNK_MAX_LENGTH', 2500, 16),
    chunkOverlap: number('CHUNK_OVERLAP', 300, 0),
    qdrantApiKey: env.QDRANT_API_KEY || undefined,
    rateLimitWindowMs: number('RATE_LIMIT_WINDOW_MS', 60000),
    rateLimitMax: number('RATE_LIMIT_MAX', 5),
    embeddingDimensions: number('EMBEDDING_DIMENSIONS', 1024),
    qdrantUrl: env.QDRANT_URL || 'http://localhost:6333',
    collection: env.QDRANT_COLLECTION || 'legislacao_visa',
    ollamaUrl: env.OLLAMA_URL || 'http://localhost:11434',
    requestTimeoutMs: number('REQUEST_TIMEOUT_MS', 120000),
    chatTimeoutMs: number('CHAT_TIMEOUT_MS', 180000),
    searchLimit: number('SEARCH_LIMIT', 6),
    searchThreshold: number('SEARCH_SCORE_THRESHOLD', 0.3, 0, 1, false),
    maxHistoryTokens: number('MAX_HISTORY_TOKENS', 5000),
    maxResponseTokens: number('MAX_RESPONSE_TOKENS', 1000),
    uploadMaxBytes: number('UPLOAD_MAX_BYTES', 25 * 1024 * 1024),
    workerLeaseMs: number('WORKER_LEASE_MS', 30000),
    workerPollMs: number('WORKER_POLL_MS', 1000),
    conversationTtlMs: number('CONVERSATION_TTL_MS', 24 * 60 * 60 * 1000),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
  };

  if (settings.chunkOverlap >= settings.chunkMaxLength - 4) throw new Error('CHUNK_OVERLAP deve ser menor que CHUNK_MAX_LENGTH - 4.');
  if (!['ollama', 'sentence-transformers'].includes(settings.embeddingProvider)) throw new Error('Configuração inválida: EMBEDDING_PROVIDER');
  for (const [name, value] of [['LLM_BASE_URL', settings.llmBaseUrl], ['QDRANT_URL', settings.qdrantUrl], ['OLLAMA_URL', settings.ollamaUrl], ['EMBEDDING_URL', settings.embeddingUrl]]) {
    if (!value) continue;
    try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error(); }
    catch { throw new Error(`Configuração inválida: ${name}`); }
  }
  return settings;
}
export type EmbeddingConfig = Pick<ReturnType<typeof readSettings>, 'embeddingModel' | 'embeddingProvider' | 'embeddingUrl' |
  'embeddingRevision' | 'embeddingQueryPrefix' | 'embeddingDocumentPrefix' | 'embeddingDimensions' | 'embeddingContextTokens' | 'collection' | 'chunkMaxLength' | 'chunkOverlap'>;
const embeddingContext = new AsyncLocalStorage<EmbeddingConfig>();
export const baseSettings = readSettings();
// Each HTTP request and ingestion job keeps one immutable model/collection snapshot.
export function withEmbeddingConfig<T>(config: EmbeddingConfig, action: () => T): T { return embeddingContext.run({ ...config }, action); }
export const settings = new Proxy(baseSettings, {
  get(target, key, receiver) {
    const context = embeddingContext.getStore();
    return context && key in context ? context[key as keyof EmbeddingConfig] : Reflect.get(target, key, receiver);
  },
});
