import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, or, lte, isNull, sql } from 'drizzle-orm';
import type { db } from '../db/index.js';
import { documentIngestionsTable as jobs, documentsTable } from '../db/schema.js';
import { ingestDocument, removeDocumentVectors, type DocumentMetadata, type ProgressCallback } from './document.js';
import { settings } from '../config/settings.js';
import { log } from '../observability/index.js';
export interface IngestionState {
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'deleting'; phase: string;
  progress: number; totalChunks: number; embeddedChunks: number; indexedChunks: number;
  error: string | null; updatedAt: string | null;
}
export interface IngestionService {
  enqueue(filename: string, legacySource?: string): void;
  isBusy(filename: string): boolean;
  remove(document: DocumentMetadata): Promise<void>;
  resume(): void;
}
export const pendingIngestion: IngestionState = {
  status: 'pending', phase: 'pending', progress: 0, totalChunks: 0, embeddedChunks: 0, indexedChunks: 0, error: null, updatedAt: null,
};
export function listIngestionStates(database: typeof db): Map<string, IngestionState> {
  return new Map(database.select().from(jobs).all().map(({ filename, legacySource: _legacy, owner: _owner, leaseUntil: _lease, ...state }) =>
    [filename, state as IngestionState]));
}
export function createIngestionService(database: typeof db, pdfDir: string, ingest = ingestDocument, removeVectors = removeDocumentVectors,
  options: { worker?: boolean; leaseMs?: number } = {}) {
  const owner = randomUUID();
  const leaseMs = options.leaseMs || settings.workerLeaseMs;
  let running = false; let stopped = false;
  const waiters: Array<() => void> = [];
  const worker = options.worker ?? process.env.INGESTION_WORKER_IN_API !== 'false';
  const state = (filename: string) => database.select().from(jobs).where(eq(jobs.filename, filename)).get();
  const eligible = () => or(eq(jobs.status, 'queued'), and(eq(jobs.status, 'processing'), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, Date.now()))));
  function schedule() {
    if (worker && !stopped) setImmediate(() => { void drain().catch(error => log('worker_error', { message: error instanceof Error ? error.message : 'unknown' })); });
  }
  function update(filename: string, patch: Partial<typeof jobs.$inferInsert>) {
    const result = database.update(jobs).set({ updatedAt: new Date().toISOString(), leaseUntil: Date.now() + leaseMs, ...patch })
      .where(and(eq(jobs.filename, filename), eq(jobs.owner, owner))).returning({ filename: jobs.filename }).get();
    if (!result) throw new Error('A tarefa foi assumida por outro worker.');
  }
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped) {
        // SQLite serializes the claim across independent processes sharing the same database file.
        const job = database.transaction(tx => {
          const candidate = tx.select().from(jobs).where(eligible()).orderBy(jobs.updatedAt).get();
          if (!candidate) return;
          return tx.update(jobs).set({ status: 'processing', phase: 'extracting', progress: 0,
            embeddedChunks: 0, indexedChunks: 0, owner, leaseUntil: Date.now() + leaseMs, updatedAt: new Date().toISOString() })
            .where(and(eq(jobs.filename, candidate.filename), eligible())).returning().get();
        }, { behavior: 'immediate' });
        if (!job) break;
        const document = database.select().from(documentsTable).where(eq(documentsTable.filename, job.filename)).get();
        if (!document) {
          database.delete(jobs).where(eq(jobs.filename, job.filename)).run(); continue;
        }
        const started = performance.now();
        const heartbeat = setInterval(() => {
          try { update(job.filename, {}); } catch { /* callback fencing prevents publishing after ownership loss */ }
        }, Math.max(20, Math.floor(leaseMs / 3)));
        heartbeat.unref();
        try {
          const report: ProgressCallback = progress => update(job.filename, progress);
          await ingest(document, pdfDir, report, job.legacySource);
          update(job.filename, { status: 'completed', phase: 'completed', progress: 100, error: null, owner: null, leaseUntil: null });
          log('ingestion_completed', { filename: job.filename, durationMs: Math.round(performance.now() - started) });
        } catch (error) {
          log('ingestion_failed', { filename: job.filename, durationMs: Math.round(performance.now() - started), errorType: error instanceof Error ? error.name : 'unknown' });
          if (state(job.filename)?.owner === owner) update(job.filename, { status: 'failed', phase: 'failed', owner: null, leaseUntil: null,
            error: 'Não foi possível ingerir o PDF. Verifique o arquivo e os serviços de indexação e tente novamente.' });
        } finally { clearInterval(heartbeat); }
      }
    } finally { running = false; for (const resolve of waiters.splice(0)) resolve(); }
  }
  const poll = worker ? setInterval(() => service.resume(), settings.workerPollMs) : undefined;
  poll?.unref();
  const service: IngestionService & { waitUntilIdle(): Promise<void>; stop(): void } = {
    stop() { stopped = true; if (poll) clearInterval(poll); },
    waitUntilIdle() { return running || (!stopped && worker && database.select().from(jobs).where(eligible()).get()) ? new Promise(resolve => { waiters.push(resolve); schedule(); }) : Promise.resolve(); },
    isBusy(filename) { return ['queued', 'processing', 'deleting'].includes(state(filename)?.status || ''); },
    enqueue(filename, legacySource) {
      const previous = state(filename);
      const inserted = database.insert(jobs).values({ filename, ...pendingIngestion, status: 'queued', phase: 'queued',
        updatedAt: new Date().toISOString(), legacySource: previous?.legacySource || legacySource || null })
        .onConflictDoUpdate({ target: jobs.filename, set: { ...pendingIngestion, status: 'queued', phase: 'queued',
          updatedAt: new Date().toISOString(), owner: null, leaseUntil: null, legacySource: previous?.legacySource || legacySource || null },
          setWhere: sql`${jobs.status} NOT IN ('queued', 'processing', 'deleting')` })
        .returning({ filename: jobs.filename }).get();
      if (inserted) schedule();
    },
    async remove(document) {
      const previous = state(document.filename);
      // Claim deletion in SQLite too: API instances cannot enqueue or modify this document concurrently.
      database.insert(jobs).values({ filename: document.filename, status: 'pending', phase: 'pending', updatedAt: new Date().toISOString() })
        .onConflictDoNothing().run();
      const claimed = database.update(jobs).set({ status: 'deleting', owner, leaseUntil: Date.now() + leaseMs })
        .where(and(eq(jobs.filename, document.filename), sql`${jobs.status} NOT IN ('queued', 'processing', 'deleting')`)).returning().get();
      if (!claimed) throw new Error('Documento ocupado.');
      const heartbeat = setInterval(() => {
        try { update(document.filename, {}); } catch { /* ownership is checked before completing */ }
      }, Math.max(20, Math.floor(leaseMs / 3)));
      heartbeat.unref();
      try { await removeVectors(document, previous?.legacySource); }
      catch (error) {
        database.update(jobs).set({ status: previous?.status || 'pending', owner: null, leaseUntil: null })
          .where(and(eq(jobs.filename, document.filename), eq(jobs.owner, owner))).run();
        throw error;
      } finally { clearInterval(heartbeat); }
      // API removes this row together with metadata; retain the deletion lock until then.
    },
    resume() {
      // Expired deletion locks retain documents for an explicit retry instead of silently deleting them.
      const expired = database.select().from(jobs).where(and(eq(jobs.status, 'deleting'), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, Date.now())))).all();
      for (const job of expired) {
        const backup = path.join(pdfDir, '.uploads', `${job.filename}.deleted`);
        const target = path.join(pdfDir, job.filename);
        if (fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target);
        database.update(jobs).set({ status: 'failed', phase: 'failed', owner: null, leaseUntil: null, error: 'Exclusão interrompida. Tente novamente.' })
          .where(and(eq(jobs.filename, job.filename), eq(jobs.status, 'deleting'), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, Date.now())))).run();
      }
      schedule();
    },
  };
  return service;
}
