import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const documentsTable = sqliteTable('documents', {
  filename: text('filename').primaryKey(),
  titulo: text('titulo').notNull(),
  esfera: text('esfera').notNull(),
  tipo: text('tipo').notNull(),
  ano: integer('ano').notNull(),
  orgao: text('orgao').notNull(),
  jurisdicao: text('jurisdicao'),
  urlOficial: text('url_oficial'),
  vigencia: text('vigencia').notNull().default('desconhecida'),
  versao: text('versao'),
});

export const documentIngestionsTable = sqliteTable('document_ingestions', {
  filename: text('filename').primaryKey().references(() => documentsTable.filename, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'),
  phase: text('phase').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  totalChunks: integer('total_chunks').notNull().default(0),
  embeddedChunks: integer('embedded_chunks').notNull().default(0),
  indexedChunks: integer('indexed_chunks').notNull().default(0),
  error: text('error'),
  updatedAt: text('updated_at').notNull(),
  legacySource: text('legacy_source'),
  owner: text('owner'),
  leaseUntil: integer('lease_until'),
});

export const ragSettingsTable = sqliteTable('rag_settings', {
  id: integer('id').primaryKey(),
  searchLimit: integer('search_limit').notNull(),
  searchThreshold: real('search_threshold').notNull(),
  maxResponseTokens: integer('max_response_tokens').notNull(),
});

export const embeddingSelectionTable = sqliteTable('embedding_selection', {
  id: integer('id').primaryKey(),
  profileId: text('profile_id').notNull(),
});
