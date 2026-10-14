import { it, expect, vi, afterEach } from 'vitest';
import { createTestDb } from '../setup.js';
import { loadConversation, saveConversation } from '../../src/rag/conversations.js';
import { settings } from '../../src/config/settings.js';
afterEach(() => vi.useRealTimers());
it('persists evidence, isolates random conversation IDs and expires old conversations', () => {
  const { db, sqlite } = createTestDb();
  try {
    const first = loadConversation(db)!;
    const second = loadConversation(db)!;
    expect(first.id).not.toBe(second.id);
    const evidence = [{ score: 0.9, content: 'Legal excerpt', artigo: 'Art. 1', esfera: 'federal' as const, fonte_pdf: 'Test' }];
    saveConversation(db, first.id, evidence);
    expect(loadConversation(db, first.id)?.evidence).toEqual(evidence);
    expect(loadConversation(db, second.id)).toBeNull();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + settings.conversationTtlMs + 1);
    expect(loadConversation(db, first.id)).toBeNull();
  } finally { sqlite.close(); }
});
