import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { samplePdf } from '../fixtures/pdf.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { documentIngestionsTable as jobs } from '../../src/db/schema.js';

describe.skipIf(process.env.RUN_LIVE_TESTS !== '1')('real Ollama / Qdrant / HTTP / worker processes', () => {
  it('recovers a killed worker, coordinates two workers, reindexes and deletes without duplicates', async () => {
    const collection = `rag_live_${Date.now()}`;
    process.env.QDRANT_COLLECTION = collection;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-live-'));
    const pdfDir = path.join(dir, 'pdfs');
    const dbPath = path.join(dir, 'database.sqlite');
    const sqlite = new Database(dbPath); sqlite.pragma('journal_mode = WAL'); sqlite.pragma('busy_timeout = 5000');
    const db = drizzle(sqlite); migrateDatabase(db);
    const [{ createApp }, { createIngestionService }, { qdrantClient }, { ingestDocument }] = await Promise.all([
      import('../../src/server.js'), import('../../src/ingestion/service.js'), import('../../src/config/qdrant.js'), import('../../src/ingestion/document.js'),
    ]);
    const service = createIngestionService(db, pdfDir, undefined, undefined, { worker: false });
    const app = createApp(db, pdfDir, (_req, _res, next) => next(), service);
    const children: ChildProcess[] = [];
    const worker = () => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/ingestion/worker.ts'], { cwd: process.cwd(),
        env: { ...process.env, DATABASE_PATH: dbPath, PDF_DIR: pdfDir, WORKER_LEASE_MS: '1000', WORKER_POLL_MS: '100' }, stdio: ['ignore', 'ignore', 'pipe'] });
      children.push(child); return child;
    };
    const state = () => db.select().from(jobs).where(eq(jobs.filename, 'sample.pdf')).get();
    const done = () => vi.waitFor(() => expect(state()?.status).toBe('completed'), { timeout: 90000, interval: 100 });
    try {
      const response = await request(app).post('/api/documents').attach('file', samplePdf(), 'sample.pdf')
        .field({ titulo: 'Synthetic test norm', esfera: 'federal', tipo: 'legislacao', ano: '2024', orgao: 'TEST', vigencia: 'vigente', urlOficial: 'https://example.org/test' });
      expect(response.status).toBe(201);
      expect(state()?.status).toBe('queued');
      const first = worker();
      await vi.waitFor(() => expect(state()?.phase).toBe('embedding'), { timeout: 60000, interval: 20 });
      const firstExited = new Promise(resolve => first.once('exit', resolve)); first.kill('SIGKILL'); await firstExited;
      worker(); worker();
      await done();
      const list = await request(app).get('/api/documents');
      expect(list.body.documents[0].ingestion).toMatchObject({ progress: 100, status: 'completed' });
      const initial = await qdrantClient.scroll(collection, { limit: 100, with_payload: true });
      expect(initial.points.length).toBeGreaterThan(0);
      expect(initial.points.some(point => point.payload?.pagina === 2)).toBe(true);
      const metadata = list.body.documents[0];
      const { ingestion: _ingestion, ...document } = metadata;
      await ingestDocument(document, pdfDir, () => {});
      expect((await qdrantClient.count(collection, { exact: true })).count).toBe(initial.points.length);
      const update = await request(app).put('/api/documents/sample.pdf').field({ titulo: 'Updated synthetic norm' });
      expect(update.status).toBe(200); await done();
      const updated = await qdrantClient.scroll(collection, { limit: 100, with_payload: true });
      expect(updated.points.every(point => point.payload?.fonte_pdf === 'Updated synthetic norm')).toBe(true);
      expect(updated.points.length).toBe(initial.points.length);
      expect((await request(app).delete('/api/documents/sample.pdf')).status).toBe(200);
      expect((await qdrantClient.count(collection, { exact: true })).count).toBe(0);
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
      }
      service.stop(); sqlite.close();
      if ((await qdrantClient.collectionExists(collection)).exists) await qdrantClient.deleteCollection(collection);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});
