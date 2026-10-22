import { EmbeddingError } from './embeddingError.js';
import { log } from '../observability/index.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { settings } from './settings.js';
import { Ollama } from 'ollama';

const requestSignals = new AsyncLocalStorage<AbortSignal>();

export const ollamaClient = new Ollama({
  host: settings.ollamaUrl,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), ...(requestSignals.getStore() ? [requestSignals.getStore()!] : []), AbortSignal.timeout(settings.requestTimeoutMs)]) }),
});

export async function generateEmbedding(text: string, signal?: AbortSignal, purpose: 'query' | 'document' = 'document'): Promise<number[]> {
  const EMBEDDING_MODEL = settings.embeddingModel;
  signal?.throwIfAborted();
  if (!EMBEDDING_MODEL) throw new Error('Configure EMBEDDING_MODEL.');
  const cleanText = text?.trim();

  if (!cleanText) {
    throw new Error('O texto fornecido para geração de embedding está vazio.');
  }

  try {
    const input = (purpose === 'query' ? settings.embeddingQueryPrefix : settings.embeddingDocumentPrefix) + cleanText;
    if (settings.embeddingProvider === 'sentence-transformers') {
      const response = await fetch(`${settings.embeddingUrl}/api/embed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(settings.requestTimeoutMs)]),
        body: JSON.stringify({ model: EMBEDDING_MODEL, input, contextTokens: settings.embeddingContextTokens }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: string };
        throw Object.assign(new Error(body.code === 'context_exceeded' ? 'input length exceeds context length' : 'embedding service error'), { status_code: response.status });
      }
      const body = await response.json() as { model?: string; embeddings?: unknown };
      const vector = Array.isArray(body.embeddings) && body.embeddings.length === 1 ? body.embeddings[0] : undefined;
      if (body.model !== EMBEDDING_MODEL || !Array.isArray(vector) || vector.length !== settings.embeddingDimensions || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('Invalid embedding response');
      }
      signal?.throwIfAborted();
      return vector;
    }
    const request = () => ollamaClient.embed({
      model: EMBEDDING_MODEL,
      input,
      truncate: false,
      options: {
        num_ctx: settings.embeddingContextTokens,
      },
    });

    const response = await (signal ? requestSignals.run(signal, request) : request());
    signal?.throwIfAborted();
    return response.embeddings[0];
  } catch (error) {
    signal?.throwIfAborted();
    const failure = new EmbeddingError(error, settings.embeddingProvider);
    log('embedding_failed', { errorType: error instanceof Error ? error.name : 'unknown',
      code: failure.code, statusCode: failure.statusCode, model: EMBEDDING_MODEL,
      contextTokens: settings.embeddingContextTokens, inputCharacters: cleanText.length });
    throw failure;
  }
}

export async function checkEmbeddingReady(): Promise<void> {
  const python = settings.embeddingProvider === 'sentence-transformers';
  const response = await fetch(python ? `${settings.embeddingUrl}/health?model=${encodeURIComponent(settings.embeddingModel)}` : `${settings.ollamaUrl}/api/tags`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('Embedding service unavailable');
  if (python) {
    const health = await response.json() as { model?: string; dimensions?: number; contextTokens?: number; revision?: string };
    if (health.model !== settings.embeddingModel || health.dimensions !== settings.embeddingDimensions ||
      !health.contextTokens || health.contextTokens < settings.embeddingContextTokens ||
      (settings.embeddingRevision && health.revision !== settings.embeddingRevision)) throw new Error('Embedding configuration mismatch');
  } else {
    const tags = await response.json() as { models: Array<{ name: string }> };
    if (!tags.models.some(model => model.name.split(':')[0] === settings.embeddingModel.split(':')[0])) throw new Error('Embedding model unavailable');
  }
}
