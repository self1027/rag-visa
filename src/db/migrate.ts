import type { db } from './index.js';

// Additive migration: existing document metadata is preserved.
export function migrateDatabase(database: typeof db) {
  database.transaction(tx => {
  const database = tx;
  database.run('CREATE TABLE IF NOT EXISTS embedding_selection (id INTEGER PRIMARY KEY CHECK (id = 1), profile_id TEXT NOT NULL)');
  database.run(`CREATE TABLE IF NOT EXISTS rag_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), search_limit INTEGER NOT NULL,
    search_threshold REAL NOT NULL, max_response_tokens INTEGER NOT NULL
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS documents (
    filename TEXT PRIMARY KEY, titulo TEXT NOT NULL, esfera TEXT NOT NULL,
    tipo TEXT NOT NULL, ano INTEGER NOT NULL, orgao TEXT NOT NULL
  )`);
  const documentColumns = database.all<{ name: string }>('PRAGMA table_info(documents)');
  for (const [name, definition] of Object.entries({ jurisdicao: 'TEXT', url_oficial: 'TEXT', vigencia: "TEXT NOT NULL DEFAULT 'desconhecida'", versao: 'TEXT' })) {
    if (!documentColumns.some(column => column.name === name)) database.run(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`);
  }
  database.run(`CREATE TABLE IF NOT EXISTS document_ingestions (
    filename TEXT PRIMARY KEY REFERENCES documents(filename) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued', phase TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0, total_chunks INTEGER NOT NULL DEFAULT 0,
    embedded_chunks INTEGER NOT NULL DEFAULT 0, indexed_chunks INTEGER NOT NULL DEFAULT 0,
    error TEXT, updated_at TEXT NOT NULL, legacy_source TEXT
  )`);
  const columns = database.all<{ name: string }>('PRAGMA table_info(document_ingestions)');
  for (const [name, definition] of Object.entries({ legacy_source: 'TEXT', owner: 'TEXT', lease_until: 'INTEGER' })) {
    if (!columns.some(column => column.name === name)) database.run(`ALTER TABLE document_ingestions ADD COLUMN ${name} ${definition}`);
  }
  database.run(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, evidence TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL
  )`);
  }, { behavior: 'immediate' });
}
