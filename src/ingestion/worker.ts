import 'dotenv/config';
import path from 'node:path';
import { db } from '../db/index.js';
import { createIngestionService } from './service.js';
const service = createIngestionService(db, path.resolve(process.env.PDF_DIR || 'data/pdfs'), undefined, undefined, { worker: true });
service.resume();
// Keep the standalone worker alive; service polling itself is unref'ed for library/test callers.
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  service.stop(); clearInterval(keepAlive); await service.waitUntilIdle(); process.exit(0);
});
