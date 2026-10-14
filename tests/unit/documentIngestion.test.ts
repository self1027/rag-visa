import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const mocks = vi.hoisted(() => ({
  setup: vi.fn(), upsert: vi.fn(), delete: vi.fn(), setPayload: vi.fn(), count: vi.fn(),
  collectionExists: vi.fn(), embedding: vi.fn(), parse: vi.fn(), chunks: vi.fn(),
}));
vi.mock('../../src/config/qdrant.js', () => ({
  qdrantClient: mocks, setupQdrantCollection: mocks.setup, COLLECTION_NAME: 'test',
}));
vi.mock('../../src/config/ollama.js', () => ({ generateEmbedding: mocks.embedding }));
vi.mock('pdf-parse-new', () => ({ default: mocks.parse }));
vi.mock('../../src/utils/chunker.js', () => ({ chunkLegislacao: mocks.chunks }));
import { ingestDocument, removeDocumentVectors } from '../../src/ingestion/document.js';
const document = { filename: 'test.pdf', titulo: 'Norma teste', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' };
let dir: string;
beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-ingestion-'));
  fs.writeFileSync(path.join(dir, document.filename), '%PDF-1.4 teste');
  mocks.count.mockResolvedValue({ count: 0 });
  mocks.parse.mockResolvedValue({ text: 'Art. 1º Conteúdo válido.' });
  mocks.embedding.mockResolvedValue(Array(1024).fill(0.1));
  mocks.chunks.mockReturnValue(Array.from({ length: 30 }, (_, i) => ({
    content: `Art. ${i}º conteúdo`, metadata: { artigo: `Art. ${i}º`, esfera: 'municipal' },
  })));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
describe('document ingestion', () => {
  it('reports monotonic progress, batches points and only publishes after every batch', async () => {
    const report = vi.fn();
    await ingestDocument(document, dir, report);
    const states = report.mock.calls.map(([state]) => state);
    expect(states.every((state, i) => !i || state.progress >= states[i - 1].progress)).toBe(true);
    expect(states.at(-1)).toMatchObject({ progress: 97, totalChunks: 30, embeddedChunks: 30, indexedChunks: 30 });
    expect(mocks.upsert.mock.calls.map(([, request]) => request.points.length)).toEqual([25, 5]);
    const point = mocks.upsert.mock.calls[0][1].points[0];
    expect(point.payload).toMatchObject({ filename: 'test.pdf', indexed: false, esfera: 'federal', fonte_pdf: 'Norma teste' });
    expect(mocks.setPayload.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.upsert.mock.invocationCallOrder.at(-1)!);
    expect(mocks.setPayload).toHaveBeenCalledWith('test', expect.objectContaining({ payload: { indexed: true }, wait: true }));
    expect(mocks.delete.mock.calls.at(-1)?.[1].filter.must_not).toEqual([{ key: 'version', match: { value: point.payload.version } }]);
  });
  it('uses the same IDs on retry and different IDs when the PDF changes', async () => {
    await ingestDocument(document, dir, vi.fn());
    const original = mocks.upsert.mock.calls[0][1].points[0].id;
    await ingestDocument(document, dir, vi.fn());
    expect(mocks.upsert.mock.calls[2][1].points[0].id).toBe(original);
    fs.writeFileSync(path.join(dir, document.filename), '%PDF-1.4 diferente');
    await ingestDocument(document, dir, vi.fn());
    expect(mocks.upsert.mock.calls[4][1].points[0].id).not.toBe(original);
  });
  it('does not overwrite a published identical version', async () => {
    mocks.count.mockResolvedValue({ count: 30 });
    await ingestDocument(document, dir, vi.fn());
    expect(mocks.embedding).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('cleans staging vectors and does not publish when a batch fails', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('Qdrant unavailable'));
    await expect(ingestDocument(document, dir, vi.fn())).rejects.toThrow('Qdrant unavailable');
    expect(mocks.setPayload).not.toHaveBeenCalled();
    expect(mocks.delete.mock.calls.at(-1)?.[1].filter.must).toContainEqual({ key: 'indexed', match: { value: false } });
  });
  it('rejects PDFs with no text and invalid embedding vectors', async () => {
    mocks.parse.mockResolvedValueOnce({ text: '   ' });
    await expect(ingestDocument(document, dir, vi.fn())).rejects.toThrow('OCR');
    mocks.embedding.mockResolvedValueOnce([NaN]);
    await expect(ingestDocument(document, dir, vi.fn())).rejects.toThrow('vetor inválido');
  });
  it('removes document vectors and tolerates an absent collection', async () => {
    mocks.collectionExists.mockResolvedValueOnce({ exists: false });
    await removeDocumentVectors(document);
    expect(mocks.delete).not.toHaveBeenCalled();
    mocks.collectionExists.mockResolvedValueOnce({ exists: true });
    await removeDocumentVectors(document);
    expect(mocks.delete).toHaveBeenCalledWith('test', expect.objectContaining({ wait: true, filter: expect.objectContaining({ should: expect.any(Array) }) }));
  });
});
