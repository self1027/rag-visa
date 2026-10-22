import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import request from 'supertest';
import { samplePdf } from '../fixtures/pdf.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { documentIngestionsTable as jobs } from '../../src/db/schema.js';

describe.skipIf(process.env.RUN_PYTHON_EMBEDDING_LIVE !== '1')('real Python embeddings and Qdrant', () => {
  it('ingests a PDF, publishes 768-dimensional vectors and retrieves them with a query', async () => {
    const collection = `rag_python_live_${Date.now()}`;
    const bertCollection = `${collection}_bert`;
    vi.stubEnv('EMBEDDING_PROVIDER', 'sentence-transformers');
    vi.stubEnv('EMBEDDING_MODEL', 'tardellirs/embeddinggemma-pt-br');
    vi.stubEnv('EMBEDDING_DIMENSIONS', '768');
    vi.stubEnv('EMBEDDING_CONTEXT_TOKENS', '2048');
    vi.stubEnv('EMBEDDING_REVISION', 'e7d1031ee97db28c3e6f87d309cca552e1481622');
    vi.stubEnv('EMBEDDING_QUERY_PREFIX', 'task: search result | query: ');
    vi.stubEnv('EMBEDDING_DOCUMENT_PREFIX', 'title: none | text: ');
    vi.stubEnv('QDRANT_COLLECTION', collection);
    vi.stubEnv('EMBEDDING_PROFILES', JSON.stringify([{
      id: 'bertimbau', label: 'BERTimbau experimental', embeddingModel: 'neuralmind/bert-base-portuguese-cased',
      embeddingProvider: 'sentence-transformers', embeddingUrl: process.env.EMBEDDING_URL || 'http://localhost:8001',
      embeddingRevision: '94d69c95f98f7d5b2a8700c420230ae10def0baa', embeddingDimensions: 768, embeddingContextTokens: 512,
      embeddingQueryPrefix: '', embeddingDocumentPrefix: '', collection: bertCollection, chunkMaxLength: 900, chunkOverlap: 120,
    }]));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-python-live-'));
    const sqlite = new Database(':memory:');
    const database = drizzle(sqlite); migrateDatabase(database);
    const [{ createApp }, { createIngestionService }, { qdrantClient }, { searchLegislacao }] = await Promise.all([
      import('../../src/server.js'), import('../../src/ingestion/service.js'),
      import('../../src/config/qdrant.js'), import('../../src/retriever/search.js'),
    ]);
    const service = createIngestionService(database, dir, undefined, undefined, { worker: true });
    const app = createApp(database, dir, (_req, _res, next) => next(), service);
    try {
      expect((await request(app).get('/api/ready')).body).toMatchObject({ status: 'ready', embeddings: true, embeddingProvider: 'sentence-transformers' });
      const upload = await request(app).post('/api/documents').attach('file', samplePdf(), 'sample.pdf')
        .field({ titulo: 'Synthetic norm', esfera: 'federal', tipo: 'legislacao', ano: '2024', orgao: 'TEST' });
      expect(upload.status).toBe(201);
      await vi.waitFor(() => expect(database.select().from(jobs).get()?.status).toBe('completed'), { timeout: 120000, interval: 100 });
      const results = await searchLegislacao('normas de vigilância sanitária', { scoreThreshold: 0 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(result => result.filename === 'sample.pdf')).toBe(true);
      const points = await qdrantClient.scroll(collection, { with_vector: true, with_payload: true });
      expect(points.points.every(point => Array.isArray(point.vector) && point.vector.length === 768 && point.payload?.indexed === true)).toBe(true);
      const selection = await request(app).put('/api/embedders').send({ id: 'bertimbau' });
      expect(selection.status).toBe(200);
      expect(selection.body.selectedId).toBe('bertimbau');
      await vi.waitFor(() => expect(database.select().from(jobs).get()?.status).toBe('completed'), { timeout: 120000, interval: 100 });
      expect((await request(app).get('/api/settings')).body.embeddingModel).toBe('neuralmind/bert-base-portuguese-cased');
      const [{ getSelectedEmbedder }, { withEmbeddingConfig }] = await Promise.all([
        import('../../src/config/embeddingProfiles.js'), import('../../src/config/settings.js'),
      ]);
      const bertResults = await withEmbeddingConfig(getSelectedEmbedder(database), () => searchLegislacao('normas de vigilância sanitária', { scoreThreshold: 0 }));
      expect(bertResults.length).toBeGreaterThan(0);
      expect(bertResults.every(result => result.filename === 'sample.pdf')).toBe(true);
    } finally {
      service.stop(); await service.waitUntilIdle(); sqlite.close();
      if ((await qdrantClient.collectionExists(collection)).exists) await qdrantClient.deleteCollection(collection);
      if ((await qdrantClient.collectionExists(bertCollection)).exists) await qdrantClient.deleteCollection(bertCollection);
      fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs();
    }
  }, 240000);
});
