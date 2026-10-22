import { settings } from '../config/settings.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/index.js';
import { documentsTable, documentIngestionsTable } from '../db/schema.js';
import { createIngestionService } from './service.js';

// The CLI and HTTP uploads share the same pipeline and persisted progress.
export async function processPdfs(pdfDir = settings.pdfDir) {
  fs.mkdirSync(pdfDir, { recursive: true });
  const documents = db.select().from(documentsTable).all();
  const filenames = new Set(documents.map(document => document.filename));
  const unregistered = fs.readdirSync(pdfDir).filter(file => file.toLowerCase().endsWith('.pdf') && !filenames.has(file));
  if (unregistered.length) {
    throw new Error(`Cadastre os metadados antes de ingerir: ${unregistered.join(', ')}`);
  }
  for (const document of documents) {
    const state = db.select().from(documentIngestionsTable).all().find(job => job.filename === document.filename);
    if (state && ['queued', 'processing', 'deleting'].includes(state.status)) {
      throw new Error(`${document.filename} já está em ingestão. Aguarde o servidor concluir.`);
    }
    if (!fs.existsSync(path.join(pdfDir, document.filename))) {
      throw new Error(`PDF cadastrado não encontrado: ${document.filename}`);
    }
  }
  const service = createIngestionService(db, pdfDir, undefined, undefined, { worker: true });
  for (const document of documents) service.enqueue(document.filename);
  await service.waitUntilIdle();
  service.stop();
  const states = db.select().from(documentIngestionsTable).all();
  const failures = states.filter(state => filenames.has(state.filename) && state.status === 'failed');
  if (failures.length) throw new Error(`Falha na ingestão de: ${failures.map(state => state.filename).join(', ')}`);
  console.log(`${documents.length} documento(s) indexado(s). Progresso disponível em GET /api/documents.`);
}

const filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(filename)) {
  processPdfs().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
