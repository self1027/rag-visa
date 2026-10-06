import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const documentsTable = sqliteTable('documents', {
  filename: text('filename').primaryKey(),
  titulo: text('titulo').notNull(),
  esfera: text('esfera').notNull(),
  tipo: text('tipo').notNull(),
  ano: integer('ano').notNull(),
  orgao: text('orgao').notNull(),
});