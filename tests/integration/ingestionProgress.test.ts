import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server.js';
import { createTestDb, seedTestDb } from '../setup.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { documentIngestionsTable } from '../../src/db/schema.js';
import { createIngestionService } from '../../src/ingestion/service.js';
import type { ProgressCallback, ingestDocument, removeDocumentVectors } from '../../src/ingestion/document.js';
vi.mock('../../src/rag/generator.js', () => ({ askRAG: vi.fn() }));
const pdf = Buffer.from('%PDF-1.4\n%test\n%%EOF');
const metadata = { titulo: 'Teste', esfera: 'federal', tipo: 'legislacao', ano: '2024', orgao: 'ANVISA' };
let testDb: ReturnType<typeof createTestDb>;
let dir: string;
let release: () => void;
let report: ProgressCallback;
let ingest: ReturnType<typeof vi.fn<typeof ingestDocument>>;
let remove: ReturnType<typeof vi.fn<typeof removeDocumentVectors>>;
let service: ReturnType<typeof createIngestionService>;
let app: ReturnType<typeof createApp>;
async function waitFor(status: string, filename = 'novo.pdf') {
  await vi.waitFor(() => expect(testDb.db.select().from(documentIngestionsTable)
    .where(eq(documentIngestionsTable.filename, filename)).get()?.status).toBe(status));
}
beforeEach(() => {
  release = () => {};
  testDb = createTestDb();
  migrateDatabase(testDb.db);
  seedTestDb(testDb.db);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-progress-'));
  ingest = vi.fn(async (_document, _dir, callback) => {
    report = callback;
    callback({ phase: 'embedding', progress: 45, totalChunks: 10, embeddedChunks: 5, indexedChunks: 0 });
    await new Promise<void>(resolve => { release = resolve; });
    callback({ phase: 'publishing', progress: 97, totalChunks: 10, embeddedChunks: 10, indexedChunks: 10 });
  });
  remove = vi.fn().mockResolvedValue(undefined);
  service = createIngestionService(testDb.db, dir, ingest, remove);
  app = createApp(testDb.db, dir, (_req, _res, next) => next(), service);
});
afterEach(async () => {
  ingest.mockResolvedValue(undefined);
  release?.();
  await service.waitUntilIdle();
  service.stop();
  testDb.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
describe('persistent ingestion progress API', () => {
  it('processes one document at a time and exposes queued documents at zero percent', async () => {
    await request(app).post('/api/documents').attach('file', pdf, 'novo.pdf').field(metadata);
    await waitFor('processing');
    await request(app).post('/api/documents').attach('file', pdf, 'second.pdf').field(metadata);
    await waitFor('queued', 'second.pdf');
    const response = await request(app).get('/api/documents');
    expect(response.body.documents.find((doc: any) => doc.filename === 'second.pdf').ingestion)
      .toMatchObject({ status: 'queued', phase: 'queued', progress: 0 });
    expect(ingest).toHaveBeenCalledTimes(1);
    release();
    await waitFor('processing', 'second.pdf');
    expect(ingest).toHaveBeenCalledTimes(2);
    release();
    await waitFor('completed', 'second.pdf');
  });
  it('automatically ingests uploads and exposes actual progress in the document list', async () => {
    const created = await request(app).post('/api/documents').attach('file', pdf, 'novo.pdf').field(metadata);
    expect(created.status).toBe(201);
    expect(created.body.metadata.ingestion).toMatchObject({ status: 'queued', progress: 0 });
    await waitFor('processing');
    const response = await request(app).get('/api/documents');
    expect(response.body.documents.find((doc: any) => doc.filename === 'novo.pdf').ingestion)
      .toMatchObject({ status: 'processing', phase: 'embedding', progress: 45, totalChunks: 10, embeddedChunks: 5 });
    report({ phase: 'indexing', progress: 80, totalChunks: 10, embeddedChunks: 10, indexedChunks: 5 });
    const updated = await request(app).get('/api/documents');
    expect(updated.body.documents.find((doc: any) => doc.filename === 'novo.pdf').ingestion.progress).toBe(80);
    release();
    await waitFor('completed');
    const complete = await request(app).get('/api/documents');
    expect(complete.body.documents.find((doc: any) => doc.filename === 'novo.pdf').ingestion)
      .toMatchObject({ status: 'completed', progress: 100, indexedChunks: 10, error: null });
  });
  it('prevents updates, deletion and duplicate jobs while processing', async () => {
    await request(app).post('/api/documents').attach('file', pdf, 'novo.pdf').field(metadata);
    await waitFor('processing');
    expect((await request(app).put('/api/documents/novo.pdf').attach('file', Buffer.from('%PDF-new'), 'novo.pdf').field(metadata)).status).toBe(409);
    expect(fs.readFileSync(path.join(dir, 'novo.pdf'))).toEqual(pdf);
    expect((await request(app).delete('/api/documents/novo.pdf')).status).toBe(409);
    expect((await request(app).post('/api/documents/novo.pdf/ingest')).status).toBe(409);
    expect(ingest).toHaveBeenCalledTimes(1);
  });
  it('persists failures and supports retry without exposing upstream secrets', async () => {
    ingest.mockRejectedValueOnce(new Error('provider secret details'));
    await request(app).post('/api/documents').attach('file', pdf, 'novo.pdf').field(metadata);
    await waitFor('failed');
    const failed = await request(app).get('/api/documents');
    const state = failed.body.documents.find((doc: any) => doc.filename === 'novo.pdf').ingestion;
    expect(state).toMatchObject({ status: 'failed', phase: 'failed' });
    expect(state.error).not.toContain('secret');
    expect(state.progress).toBeLessThan(100);
    expect((await request(app).post('/api/documents/novo.pdf/ingest')).status).toBe(202);
    await waitFor('processing');
    release();
    await waitFor('completed');
  });
  it('marks existing documents as pending and resumes interrupted jobs', async () => {
    const existing = await request(app).get('/api/documents');
    expect(existing.body.documents[0].ingestion).toMatchObject({ status: 'pending', progress: 0 });
    const filename = 'rdc_67_2007.pdf';
    testDb.db.insert(documentIngestionsTable).values({ filename, status: 'processing', phase: 'embedding', progress: 42, updatedAt: new Date().toISOString() }).run();
    service.resume();
    await vi.waitFor(() => expect(ingest).toHaveBeenCalled());
    await waitFor('processing', filename);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ filename }), dir, expect.any(Function), null);
    release();
    await waitFor('completed', filename);
  });
  it('reindexes metadata updates and removes vectors on deletion', async () => {
    await request(app).post('/api/documents').attach('file', pdf, 'novo.pdf').field(metadata);
    await waitFor('processing');
    release();
    await waitFor('completed');
    expect((await request(app).put('/api/documents/novo.pdf').field({ titulo: 'Novo título' })).status).toBe(200);
    await waitFor('processing');
    expect(ingest.mock.calls.at(-1)?.[0].titulo).toBe('Novo título');
    release();
    await waitFor('completed');
    expect((await request(app).delete('/api/documents/novo.pdf')).status).toBe(200);
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ filename: 'novo.pdf' }), 'Teste');
    expect(testDb.db.select().from(documentIngestionsTable).all()).toEqual([]);
  });
});
