import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQdrantClient, mockQdrantQuery, mockQdrantGetCollections, mockQdrantCreateCollection, mockGenerateEmbedding } = vi.hoisted(() => {
  const mockQdrantQuery = vi.fn();
  const mockQdrantGetCollections = vi.fn();
  const mockQdrantCreateCollection = vi.fn();
  const mockGenerateEmbedding = vi.fn();
  const mockQdrantClient = {
    query: mockQdrantQuery,
    getCollections: mockQdrantGetCollections,
    createCollection: mockQdrantCreateCollection,
  };
  return { mockQdrantClient, mockQdrantQuery, mockQdrantGetCollections, mockQdrantCreateCollection, mockGenerateEmbedding };
});

vi.mock('../../src/config/qdrant.js', () => ({
  qdrantClient: mockQdrantClient,
  COLLECTION_NAME: 'legislacao_visa_test',
  setupQdrantCollection: vi.fn(),
}));

vi.mock('../../src/config/ollama.js', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

import { searchLegislacao, SearchOptions, SearchResult } from '../../src/retriever/search.js';

describe('searchLegislacao', () => {
  const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
  
  const mockPoint = (overrides = {}) => ({
    id: 'test-id',
    score: 0.9,
    payload: {
      content: 'Conteúdo do artigo.',
      artigo: 'Art. 1º',
      livro: 'LIVRO I',
      titulo: 'TÍTULO I',
      capitulo: 'CAPÍTULO I',
      secao: 'SEÇÃO I',
      tipo_documento: 'legislacao',
      esfera: 'federal',
      fonte_pdf: 'rdc_67_2007.pdf',
    },
    // Overrides apply to the point (id, score, payload...), not just the payload
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(mockEmbedding);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('embedding generation', () => {
    it('should generate embedding from query', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('consulta de teste');
      
      expect(mockGenerateEmbedding).toHaveBeenCalledWith('consulta de teste');
    });

    it('should pass query to embedding function', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('armazenamento de alimentos RDC 216');
      
      expect(mockGenerateEmbedding).toHaveBeenCalledWith('armazenamento de alimentos RDC 216');
    });
  });

  describe('default options', () => {
    it('should use default limit of 5', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query');
      
      expect(mockQdrantQuery).toHaveBeenCalledWith(
        'legislacao_visa_test',
        expect.objectContaining({ limit: 5 })
      );
    });

    it('should use default scoreThreshold of 0.3', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query');
      
      expect(mockQdrantQuery).toHaveBeenCalledWith(
        'legislacao_visa_test',
        expect.objectContaining({ score_threshold: 0.3 })
      );
    });
  });

  describe('option overrides', () => {
    it('should override limit', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query', { limit: 10 });
      
      expect(mockQdrantQuery).toHaveBeenCalledWith(
        'legislacao_visa_test',
        expect.objectContaining({ limit: 10 })
      );
    });

    it('should override scoreThreshold', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query', { scoreThreshold: 0.5 });
      
      expect(mockQdrantQuery).toHaveBeenCalledWith(
        'legislacao_visa_test',
        expect.objectContaining({ score_threshold: 0.5 })
      );
    });

    it('should apply esfera filter', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query', { esfera: 'federal' });
      
      expect(mockQdrantQuery).toHaveBeenCalledWith(
        'legislacao_visa_test',
        expect.objectContaining({
          filter: expect.objectContaining({
            must: expect.arrayContaining([
              expect.objectContaining({ key: 'esfera', match: { value: 'federal' } })
            ])
          })
        })
      );
    });

    it('should apply artigo filter', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query', { artigo: 'Art. 1º' });
      
      expect(mockQdrantQuery).toHaveBeenCalledWith(
        'legislacao_visa_test',
        expect.objectContaining({
          filter: expect.objectContaining({
            must: expect.arrayContaining([
              expect.objectContaining({ key: 'artigo', match: { value: 'Art. 1º' } })
            ])
          })
        })
      );
    });

    it('should combine multiple filters', async () => {
      mockQdrantQuery.mockResolvedValue({ points: [] });
      
      await searchLegislacao('query', { esfera: 'estadual', artigo: 'Art. 5º' });
      
      const callArgs = mockQdrantQuery.mock.calls[0][1];
      const mustFilters = callArgs.filter.must;
      
      expect(mustFilters).toContainEqual(expect.objectContaining({ key: 'esfera', match: { value: 'estadual' } }));
      expect(mustFilters).toContainEqual(expect.objectContaining({ key: 'artigo', match: { value: 'Art. 5º' } }));
    });
  });

  describe('general search', () => {
    it('should execute general search with filters', async () => {
      const points = [mockPoint(), mockPoint({ id: '2', score: 0.8 })];
      mockQdrantQuery.mockResolvedValue({ points });
      
      const results = await searchLegislacao('query', { esfera: 'federal' });
      
      expect(results).toHaveLength(2);
      expect(mockQdrantQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('municipal search guarantee', () => {
    it('should execute municipal search to guarantee at least one municipal result', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [mockPoint({ payload: { ...mockPoint().payload, esfera: 'federal' } })] })
        .mockResolvedValueOnce({ points: [mockPoint({ payload: { ...mockPoint().payload, esfera: 'municipal' } })] });
      
      await searchLegislacao('query', { esfera: 'federal' });
      
      const municipalCall = mockQdrantQuery.mock.calls[1];
      expect(municipalCall[1].filter).toEqual(
        expect.objectContaining({
          must: expect.arrayContaining([
            expect.objectContaining({ key: 'esfera', match: { value: 'municipal' } })
          ])
        })
      );
    });

    it('should replace esfera filter with municipal in municipal search', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [] })
        .mockResolvedValueOnce({ points: [] });
      
      await searchLegislacao('query', { esfera: 'federal' });
      
      const municipalCall = mockQdrantQuery.mock.calls[1];
      const mustFilters = municipalCall[1].filter.must;
      
      const esferaFilters = mustFilters.filter((f: any) => f.key === 'esfera');
      expect(esferaFilters).toHaveLength(1);
      expect(esferaFilters[0]).toEqual({ key: 'esfera', match: { value: 'municipal' } });
    });

    it('should add municipal filter when no esfera specified', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [] })
        .mockResolvedValueOnce({ points: [] });
      
      await searchLegislacao('query');
      
      const municipalCall = mockQdrantQuery.mock.calls[1];
      const mustFilters = municipalCall[1].filter.must;
      
      expect(mustFilters).toContainEqual({ key: 'esfera', match: { value: 'municipal' } });
    });

    it('should limit municipal search to 1 result', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [] })
        .mockResolvedValueOnce({ points: [] });
      
      await searchLegislacao('query', { limit: 10 });
      
      const municipalCall = mockQdrantQuery.mock.calls[1];
      expect(municipalCall[1].limit).toBe(1);
    });
  });

  describe('result combination and deduplication', () => {
    it('should prioritize municipal results', async () => {
      const municipalPoint = mockPoint({ 
        id: 'municipal-1', 
        payload: { ...mockPoint().payload, esfera: 'municipal', artigo: 'Art. 10º' } 
      });
      const generalPoints = [
        mockPoint({ id: 'general-1', payload: { ...mockPoint().payload, esfera: 'federal', artigo: 'Art. 1º' } }),
        mockPoint({ id: 'general-2', payload: { ...mockPoint().payload, esfera: 'federal', artigo: 'Art. 2º' } }),
      ];
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: generalPoints })
        .mockResolvedValueOnce({ points: [municipalPoint] });
      
      const results = await searchLegislacao('query', { limit: 3 });
      
      expect(results[0].artigo).toBe('Art. 10º');
      expect(results[0].esfera).toBe('municipal');
    });

    it('should deduplicate by ID', async () => {
      const sharedPoint = mockPoint({ id: 'shared-id', score: 0.95 });
      // Artigos distintos para que a contagem por artigo isole o ponto duplicado
      const generalPoints = [
        sharedPoint,
        mockPoint({ id: 'general-2', payload: { ...mockPoint().payload, artigo: 'Art. 2º' } }),
      ];
      const municipalPoints = [sharedPoint];
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: generalPoints })
        .mockResolvedValueOnce({ points: municipalPoints });
      
      const results = await searchLegislacao('query', { limit: 5 });
      
      const sharedCount = results.filter(r => r.artigo === sharedPoint.payload.artigo).length;
      expect(sharedCount).toBe(1);
    });

    it('should respect limit after combining', async () => {
      const generalPoints = Array(5).fill(null).map((_, i) => mockPoint({ id: `gen-${i}` }));
      const municipalPoints = [
        mockPoint({ id: 'municipal-1', payload: { ...mockPoint().payload, esfera: 'municipal' } }),
      ];
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: generalPoints })
        .mockResolvedValueOnce({ points: municipalPoints });
      
      const results = await searchLegislacao('query', { limit: 3 });
      
      expect(results).toHaveLength(3);
      expect(results[0].esfera).toBe('municipal');
    });

    it('should combine results up to limit', async () => {
      const generalPoints = [mockPoint({ id: '1' }), mockPoint({ id: '2' })];
      const municipalPoints = [mockPoint({ id: '3' })];
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: generalPoints })
        .mockResolvedValueOnce({ points: municipalPoints });
      
      const results = await searchLegislacao('query', { limit: 5 });
      
      expect(results).toHaveLength(3);
    });
  });

  describe('empty responses', () => {
    it('should handle empty general search', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [] })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results).toEqual([]);
    });

    it('should handle empty municipal search', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [mockPoint()] })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results).toHaveLength(1);
    });

    it('should handle response with points property', async () => {
      const points = [mockPoint()];
      mockQdrantQuery
        .mockResolvedValueOnce({ points })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results).toHaveLength(1);
    });

    it('should handle response as array directly (alternative format)', async () => {
      const points = [mockPoint()];
      mockQdrantQuery
        .mockResolvedValueOnce(points)
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results).toHaveLength(1);
    });
  });

  describe('payload mapping', () => {
    it('should map all payload fields to SearchResult', async () => {
      const fullPoint = mockPoint({
        payload: {
          content: 'Conteúdo completo',
          artigo: 'Art. 5º',
          livro: 'LIVRO II',
          titulo: 'TÍTULO III',
          capitulo: 'CAPÍTULO IV',
          secao: 'SEÇÃO V',
          tipo_documento: 'modelo_notificacao',
          esfera: 'estadual',
          fonte_pdf: 'lei_10083_1998.pdf',
        }
      });
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [fullPoint] })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results[0]).toEqual({
        score: 0.9,
        content: 'Conteúdo completo',
        artigo: 'Art. 5º',
        livro: 'LIVRO II',
        titulo: 'TÍTULO III',
        capitulo: 'CAPÍTULO IV',
        secao: 'SEÇÃO V',
        esfera: 'estadual',
        fonte_pdf: 'lei_10083_1998.pdf',
      });
    });

    it('should handle missing optional fields', async () => {
      const minimalPoint = mockPoint({
        payload: {
          content: 'Mínimo',
          artigo: 'Art. 1º',
          tipo_documento: 'legislacao',
          esfera: 'municipal',
          fonte_pdf: 'doc.pdf',
        }
      });
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [minimalPoint] })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results[0].livro).toBeNull();
      expect(results[0].titulo).toBeNull();
      expect(results[0].capitulo).toBeNull();
      expect(results[0].secao).toBeNull();
    });

    it('should handle null values in payload', async () => {
      const pointWithNulls = mockPoint({
        payload: {
          content: 'Teste',
          artigo: 'Art. 1º',
          livro: null,
          titulo: null,
          capitulo: null,
          secao: null,
          tipo_documento: 'legislacao',
          esfera: 'federal',
          fonte_pdf: 'doc.pdf',
        }
      });
      
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [pointWithNulls] })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(results[0].livro).toBeNull();
      expect(results[0].titulo).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should propagate embedding generation errors', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('Ollama connection failed'));
      
      await expect(searchLegislacao('query')).rejects.toThrow('Ollama connection failed');
    });

    it('should propagate Qdrant query errors', async () => {
      mockQdrantQuery.mockRejectedValue(new Error('Qdrant unavailable'));
      
      await expect(searchLegislacao('query')).rejects.toThrow('Qdrant unavailable');
    });

    it('should propagate municipal search errors', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [] })
        .mockRejectedValueOnce(new Error('Municipal search failed'));
      
      await expect(searchLegislacao('query')).rejects.toThrow('Municipal search failed');
    });
  });

  describe('return type', () => {
    it('should return array of SearchResult', async () => {
      mockQdrantQuery
        .mockResolvedValueOnce({ points: [mockPoint()] })
        .mockResolvedValueOnce({ points: [] });
      
      const results = await searchLegislacao('query');
      
      expect(Array.isArray(results)).toBe(true);
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('artigo');
      expect(results[0]).toHaveProperty('esfera');
      expect(results[0]).toHaveProperty('fonte_pdf');
    });
  });
});