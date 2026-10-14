import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { db } from '../db/index.js';
import type { SearchResult } from '../retriever/search.js';
import { settings } from '../config/settings.js';
export function loadConversation(database: typeof db, id?: string) {
  database.run(sql`DELETE FROM conversations WHERE updated_at < ${Date.now() - settings.conversationTtlMs}`);
  if (id) {
    const row = database.get<{ evidence: string }>(sql`SELECT evidence FROM conversations WHERE id = ${id}`);
    if (!row) return null;
    return { id, evidence: JSON.parse(row.evidence) as SearchResult[] };
  }
  return { id: randomUUID(), evidence: [] as SearchResult[] };
}
export function saveConversation(database: typeof db, id: string, evidence: SearchResult[]) {
  database.run(sql`INSERT INTO conversations(id, evidence, updated_at) VALUES (${id}, ${JSON.stringify(evidence)}, ${Date.now()})
    ON CONFLICT(id) DO UPDATE SET evidence = excluded.evidence, updated_at = excluded.updated_at`);
}

// Revalidate IDs before reusing excerpts: deleted/replaced/revoked points cannot ground a follow-up.
export async function refreshEvidence(evidence: SearchResult[]) {
  if (!evidence.length) return [];
  const { qdrantClient, COLLECTION_NAME } = await import('../config/qdrant.js');
  const ids = evidence.flatMap(hit => hit.id === undefined ? [] : [hit.id]);
  if (!ids.length) return [];
  const points = await qdrantClient.retrieve(COLLECTION_NAME, { ids, with_payload: true });
  const valid = new Set(points.filter(point => point.payload?.indexed !== false && point.payload?.vigencia !== 'revogada').map(point => point.id));
  return evidence.filter(hit => hit.id !== undefined && valid.has(hit.id));
}
