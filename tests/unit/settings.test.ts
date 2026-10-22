import { describe, it, expect } from 'vitest';
import { readSettings } from '../../src/config/settings.js';

describe('configuração por ambiente', () => {
  it('seleciona provedor, modelo e parâmetros sem alterar o código', () => {
    const settings = readSettings({
      LLM_BASE_URL: 'http://inferencia:8080/v1', LLM_MODEL: 'modelo-local', LLM_API_KEY: 'local',
      GROQ_MODEL: 'legado', GROQ_API_KEY: 'legada',
      EMBEDDING_MODEL: 'outro-embedding', EMBEDDING_DIMENSIONS: '768',
      EMBEDDING_CONTEXT_TOKENS: '4096', INGESTION_BATCH_SIZE: '7',
      CHUNK_MAX_LENGTH: '1200', CHUNK_OVERLAP: '100', SEARCH_SCORE_THRESHOLD: '0.75',
      RATE_LIMIT_MAX: '20', PDF_DIR: '/tmp/pdfs-alternativos', DATABASE_PATH: '/tmp/metadados.sqlite',
    });
    expect(settings).toMatchObject({
      llmBaseUrl: 'http://inferencia:8080/v1', llmModel: 'modelo-local', llmApiKey: 'local',
      embeddingModel: 'outro-embedding', embeddingDimensions: 768, embeddingContextTokens: 4096,
      ingestionBatchSize: 7, chunkMaxLength: 1200, chunkOverlap: 100, searchThreshold: 0.75,
      rateLimitMax: 20, pdfDir: '/tmp/pdfs-alternativos', databasePath: '/tmp/metadados.sqlite',
    });
  });

  it('aceita aliases legados sem escolher um provedor implicitamente', () => {
    expect(readSettings({ GROQ_MODEL: 'legado', GROQ_API_KEY: 'chave' })).toMatchObject({
      llmModel: 'legado', llmApiKey: 'chave', llmBaseUrl: '', embeddingModel: '',
    });
  });

  it.each([
    { PORT: '65536' }, { SEARCH_LIMIT: '1.5' }, { INGESTION_BATCH_SIZE: '0' },
    { SEARCH_SCORE_THRESHOLD: '1.01' }, { CHUNK_MAX_LENGTH: '100', CHUNK_OVERLAP: '99' },
    { QDRANT_URL: 'arquivo-local' }, { LLM_BASE_URL: 'file:///tmp/modelo' },
    { EMBEDDING_PROVIDER: 'invalid' }, { EMBEDDING_URL: 'file:///tmp/modelo' },
  ])('rejeita configuração inválida: %j', env => {
    expect(() => readSettings(env)).toThrow();
  });
});

it('divide textos com limite configurado e sobreposição alta sem perder o avanço', async () => {
  const { vi } = await import('vitest');
  try {
    vi.stubEnv('CHUNK_MAX_LENGTH', '120');
    vi.stubEnv('CHUNK_OVERLAP', '100');
    vi.resetModules();
    const { chunkLegislacao } = await import('../../src/utils/chunker.js');
    const chunks = chunkLegislacao(`Art. 1º ${'Texto para divisão. '.repeat(4)}\n${'Mais texto. '.repeat(40)}`, 'norma.pdf');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.content.length <= 120)).toBe(true);
    expect(chunks.at(-1)?.content.endsWith('Mais texto.')).toBe(true);
  } finally { vi.unstubAllEnvs(); vi.resetModules(); }
});
