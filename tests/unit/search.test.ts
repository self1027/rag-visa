import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), embedding: vi.fn() }));
vi.mock('../../src/config/qdrant.js', () => ({ qdrantClient: mocks, COLLECTION_NAME: 'test' }));
vi.mock('../../src/config/ollama.js', () => ({ generateEmbedding: mocks.embedding }));
import { searchLegislacao } from '../../src/retriever/search.js';
const point = (id = '1', extra = {}) => ({ id, score: 0.9, payload: { content: 'Artigo legal', artigo: 'Art. 1º', esfera: 'federal', fonte_pdf: 'Lei teste', ...extra } });
beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue({ points: [] }); mocks.embedding.mockResolvedValue([0.1]); });
it('respects explicit sphere and article without a municipal override', async () => {
  mocks.query.mockResolvedValue({ points: [point()] });
  const result = await searchLegislacao('query', { esfera: 'federal', artigo: 'Art. 1º', preferMunicipal: true, jurisdicao: 'Cidade/SP' });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][1].filter.must).toContainEqual({ key: 'esfera', match: { value: 'federal' } });
  expect(mocks.query.mock.calls[0][1].filter.must).toContainEqual({ key: 'artigo', match: { value: 'Art. 1º' } });
  expect(result).toHaveLength(1);
});
it('excludes unpublished and revoked points and uses configured limits', async () => {
  await searchLegislacao('query', { limit: 3, scoreThreshold: 0.5 });
  expect(mocks.query.mock.calls[0][1]).toMatchObject({ limit: 3, score_threshold: 0.5, filter: { must_not: [
    { key: 'indexed', match: { value: false } }, { key: 'vigencia', match: { value: 'revogada' } },
  ] } });
});
it('only applies municipal preference when an explicit jurisdiction is provided', async () => {
  await searchLegislacao('query', { preferMunicipal: true });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  mocks.query.mockReset().mockResolvedValueOnce({ points: [point('1'), point('2')] })
    .mockResolvedValueOnce({ points: [point('2', { esfera: 'municipal', jurisdicao: 'Cidade/SP' })] });
  const result = await searchLegislacao('query', { preferMunicipal: true, jurisdicao: 'Cidade/SP', limit: 2 });
  expect(result.map(hit => hit.id)).toEqual(['2', '1']);
  expect(mocks.query.mock.calls[1][1].filter.must).toContainEqual({ key: 'jurisdicao', match: { value: 'Cidade/SP' } });
});
it('maps provenance and ignores malformed payloads', async () => {
  mocks.query.mockResolvedValue({ points: [point('1', { filename: 'test.pdf', pagina: 2, paginaFim: 3, url_oficial: 'https://example.org/lei', vigencia: 'vigente', versao: '2024' }), { id: 'bad', payload: {} }] });
  expect(await searchLegislacao('query')).toMatchObject([{ id: '1', filename: 'test.pdf', pagina: 2, paginaFim: 3, vigencia: 'vigente', versao: '2024', urlOficial: 'https://example.org/lei' }]);
});
it('propagates service errors and cancellation', async () => {
  mocks.embedding.mockRejectedValueOnce(new Error('Ollama unavailable'));
  await expect(searchLegislacao('query')).rejects.toThrow('Ollama unavailable');
  mocks.query.mockRejectedValueOnce(new Error('Qdrant unavailable'));
  await expect(searchLegislacao('query')).rejects.toThrow('Qdrant unavailable');
  const controller = new AbortController(); controller.abort();
  await expect(searchLegislacao('query', { signal: controller.signal })).rejects.toThrow();
});
