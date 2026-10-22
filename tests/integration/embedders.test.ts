import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server.js';
import { createTestDb } from '../setup.js';
import { documentsTable } from '../../src/db/schema.js';
import { getEmbeddingProfiles, getSelectedEmbedder } from '../../src/config/embeddingProfiles.js';
vi.mock('../../src/config/qdrant.js', () => ({ setupQdrantCollection: vi.fn(), getCollectionName: () => 'test', qdrantClient: {} }));

let database: ReturnType<typeof createTestDb>;
const ingestion = { enqueue: vi.fn(), remove: vi.fn(), resume: vi.fn(), isBusy: () => false };
const alternate = { id: 'alternative', label: 'Outro modelo', embeddingProvider: 'sentence-transformers',
  embeddingModel: 'test-embedder', embeddingUrl: 'http://private-server:8001', embeddingRevision: 'revision',
  embeddingDimensions: 768, embeddingContextTokens: 512, collection: 'alternative_vectors',
  embeddingQueryPrefix: '', embeddingDocumentPrefix: '', chunkMaxLength: 900, chunkOverlap: 100 };
const app = () => createApp(database.db, '/tmp/unused-embedders', undefined, ingestion);
beforeEach(() => {
  database = createTestDb();
  vi.stubEnv('ADMIN_API_TOKEN', '');
  vi.stubEnv('EMBEDDING_PROFILES', JSON.stringify([alternate]));
  vi.stubGlobal('fetch', vi.fn(async (url, init) => String(url).includes('/health')
    ? Response.json({ model: 'test-embedder', dimensions: 768, contextTokens: 512, revision: 'revision' })
    : Response.json({ model: JSON.parse(init.body).model, embeddings: [Array(768).fill(0.1)] })));
});
afterEach(() => { database.sqlite.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('lists configured choices without exposing URLs or accepting arbitrary configuration', async () => {
  const response = await request(app()).get('/api/embedders');
  expect(response.body.selectedId).toBe('default');
  expect(response.body.profiles).toHaveLength(2);
  expect(JSON.stringify(response.body)).not.toContain('private-server');
  for (const value of [{ id: 'unknown' }, { id: 'alternative', embeddingUrl: 'http://attacker' }, {}]) {
    expect((await request(app()).put('/api/embedders').send(value)).status).toBe(400);
    expect(getSelectedEmbedder(database.db).id).toBe('default');
  }
});

it('persists selection, queues PDFs and exposes the selected model on subsequent requests', async () => {
  database.db.insert(documentsTable).values({ filename: 'test.pdf', titulo: 'Test', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'Test' }).run();
  const response = await request(app()).put('/api/embedders').send({ id: 'alternative' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ selectedId: 'alternative', changed: true });
  expect(ingestion.enqueue).toHaveBeenCalledWith('test.pdf');
  expect((await request(app()).get('/api/settings')).body.embeddingModel).toBe('test-embedder');
  expect((await request(app()).get('/api/documents')).body.embedderId).toBe('alternative');
  ingestion.enqueue.mockClear();
  expect((await request(app()).put('/api/embedders').send({ id: 'alternative' })).body.changed).toBe(false);
  expect(ingestion.enqueue).not.toHaveBeenCalled();
});

it('keeps the current selection when the new model cannot generate embeddings', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
  expect((await request(app()).put('/api/embedders').send({ id: 'alternative' })).status).toBe(400);
  expect(getSelectedEmbedder(database.db).id).toBe('default');
});

it('protects both selection routes with the administrative token', async () => {
  vi.stubEnv('ADMIN_API_TOKEN', 'secret');
  expect((await request(app()).get('/api/embedders')).status).toBe(401);
  expect((await request(app()).put('/api/embedders').send({ id: 'alternative' })).status).toBe(401);
});

it('rejects duplicate collections to avoid mixing embedding spaces', () => {
  const collection = getEmbeddingProfiles()[0].collection;
  vi.stubEnv('EMBEDDING_PROFILES', JSON.stringify([{ ...alternate, collection }]));
  expect(getEmbeddingProfiles).toThrow('exclusivos');
});
