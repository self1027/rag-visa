import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateEmbedding, checkEmbeddingReady } from '../../src/config/ollama.js';
import { settings } from '../../src/config/settings.js';

const original = { ...settings };
const request = vi.fn();
beforeEach(() => {
  Object.assign(settings, { embeddingProvider: 'sentence-transformers', embeddingUrl: 'http://embeddings:8001',
    embeddingModel: 'bge-m3', embeddingDimensions: 768, embeddingContextTokens: 2048,
    embeddingRevision: 'revision-test', embeddingQueryPrefix: 'task: search result | query: ', embeddingDocumentPrefix: 'title: none | text: ' });
  vi.stubGlobal('fetch', request);
});
afterEach(() => { Object.assign(settings, original); vi.unstubAllGlobals(); request.mockReset(); });

it('sends different retrieval prompts and preserves cancellation', async () => {
  const vector = Array(768).fill(0.1);
  request.mockImplementation(async () => Response.json({ model: 'bge-m3', embeddings: [vector] }));
  await expect(generateEmbedding('  documento  ')).resolves.toEqual(vector);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ model: 'bge-m3', input: 'title: none | text: documento', contextTokens: 2048 });
  await generateEmbedding('pergunta', undefined, 'query');
  expect(JSON.parse(request.mock.calls[1][1].body).input).toBe('task: search result | query: pergunta');
  const controller = new AbortController(); controller.abort();
  await expect(generateEmbedding('pergunta', controller.signal, 'query')).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([
  { model: 'bge-m3', embeddings: [[1, 2]] },
  { model: 'wrong-model', embeddings: [Array(768).fill(0.1)] },
  { model: 'bge-m3', embeddings: [Array(768).fill('0.1')] },
])('rejects malformed model outputs: $model', async body => {
  request.mockResolvedValue(Response.json(body));
  await expect(generateEmbedding('documento')).rejects.toMatchObject({ code: 'service_error' });
});

it('reports context overflow without leaking upstream text', async () => {
  request.mockResolvedValue(Response.json({ code: 'context_exceeded', detail: 'documento privado' }, { status: 422 }));
  await expect(generateEmbedding('documento')).rejects.toMatchObject({ code: 'context_exceeded', statusCode: 422 });
  request.mockResolvedValue(Response.json({ code: 'service_error', detail: 'documento privado' }, { status: 500 }));
  await expect(generateEmbedding('documento')).rejects.toThrow('serviço de embeddings Python');
});

it('requires the expected model, dimensions, context and revision at readiness', async () => {
  const health = { model: 'bge-m3', dimensions: 768, contextTokens: 2048, revision: 'revision-test' };
  request.mockResolvedValueOnce(Response.json(health));
  await expect(checkEmbeddingReady()).resolves.toBeUndefined();
  for (const patch of [{ model: 'wrong' }, { dimensions: 1024 }, { contextTokens: 512 }, { revision: 'wrong' }]) {
    request.mockResolvedValueOnce(Response.json({ ...health, ...patch }));
    await expect(checkEmbeddingReady()).rejects.toThrow('mismatch');
  }
});
