import { log } from '../observability/index.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { settings } from './settings.js';
import { Ollama } from 'ollama';

const requestSignals = new AsyncLocalStorage<AbortSignal>();

export const ollamaClient = new Ollama({
  host: settings.ollamaUrl,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), ...(requestSignals.getStore() ? [requestSignals.getStore()!] : []), AbortSignal.timeout(settings.requestTimeoutMs)]) }),
});

const EMBEDDING_MODEL = settings.embeddingModel;

export async function generateEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
  signal?.throwIfAborted();
  const cleanText = text?.trim();

  if (!cleanText) {
    throw new Error('O texto fornecido para geração de embedding está vazio.');
  }

  try {
    const request = () => ollamaClient.embeddings({
      model: EMBEDDING_MODEL,
      prompt: cleanText,
      options: {
        num_ctx: 8192,
      },
    });

    const response = await (signal ? requestSignals.run(signal, request) : request());
    signal?.throwIfAborted();
    return response.embedding;
  } catch (error) {
    log('embedding_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
    throw error;
  }
}