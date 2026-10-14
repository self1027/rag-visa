import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAnalyzeAndNormalizeQuery, mockSearchLegislacao, mockGroqCreate } = vi.hoisted(() => ({
  mockAnalyzeAndNormalizeQuery: vi.fn(),
  mockSearchLegislacao: vi.fn(),
  mockGroqCreate: vi.fn(),
}));

vi.mock('../../src/rag/normalizer.js', () => ({
  analyzeAndNormalizeQuery: mockAnalyzeAndNormalizeQuery,
}));

vi.mock('../../src/retriever/search.js', () => ({
  searchLegislacao: mockSearchLegislacao,
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockGroqCreate,
      },
    };
    constructor() {
      this.chat = {
        completions: {
          create: mockGroqCreate,
        },
      };
    }
  }
  return {
    default: MockOpenAI,
  };
});

vi.mock('dotenv/config', () => ({}));

import { askRAG, ChatMessage } from '../../src/rag/generator.js';
import { SearchResult } from '../../src/retriever/search.js';

describe('askRAG', () => {
  const mockSearchResult: SearchResult = {
    score: 0.9,
    content: 'Conteúdo do artigo legal.',
    artigo: 'Art. 1º',
    livro: 'LIVRO I',
    titulo: 'TÍTULO I',
    capitulo: null,
    secao: null,
    esfera: 'federal',
    fonte_pdf: 'rdc_67_2007.pdf',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-key';
    mockAnalyzeAndNormalizeQuery.mockReset();
    mockSearchLegislacao.mockReset();
    mockSearchLegislacao.mockResolvedValue([mockSearchResult]);
    mockGroqCreate.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('input validation', () => {
    it('should throw when no user message in history', async () => {
      const history: ChatMessage[] = [
        { role: 'assistant', content: 'Only assistant message' },
      ];

      await expect(askRAG(history)).rejects.toThrow('Nenhuma mensagem de usuário encontrada no histórico.');
    });

    it('should throw when history is empty', async () => {
      const history: ChatMessage[] = [];
      await expect(askRAG(history)).rejects.toThrow('Nenhuma mensagem de usuário encontrada no histórico.');
    });

    it('should select last user message when multiple exist', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Primeira pergunta' },
        { role: 'assistant', content: 'Resposta 1' },
        { role: 'user', content: 'Segunda pergunta' },
        { role: 'assistant', content: 'Resposta 2' },
        { role: 'user', content: 'Terceira pergunta' },
      ];

      await askRAG(history);

      expect(mockGroqCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('Terceira pergunta'),
            }),
          ]),
        }), { signal: undefined }
      );
    });
  });

  describe('search behavior', () => {
    it('should call searchLegislacao when needsSearch is true', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'consulta normalizada',
      });
      mockSearchLegislacao.mockResolvedValue([mockSearchResult]);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Pergunta técnica' },
      ];

      await askRAG(history);

      expect(mockSearchLegislacao).toHaveBeenCalledWith('consulta normalizada', {
        limit: 6,
        scoreThreshold: 0.3,
        signal: undefined,
      });
    });

    it('should NOT call searchLegislacao when needsSearch is false', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Obrigado' },
      ];

      await askRAG(history);

      expect(mockSearchLegislacao).not.toHaveBeenCalled();
    });

    it('should use normalized query for search', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'query normalizada específica',
      });
      mockSearchLegislacao.mockResolvedValue([mockSearchResult]);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Pergunta original longa' },
      ];

      await askRAG(history);

      expect(mockSearchLegislacao).toHaveBeenCalledWith('query normalizada específica', expect.any(Object));
    });
  });

  describe('context construction', () => {
    it('should build context from search results', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'query',
      });
      mockSearchLegislacao.mockResolvedValue([mockSearchResult]);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Pergunta' },
      ];

      await askRAG(history);

      const callArgs = mockGroqCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      
      expect(userMessage.content).toContain('Contexto Legislativo Recuperado:');
      expect(userMessage.content).toContain('Art. 1º');
      expect(userMessage.content).toContain('rdc_67_2007.pdf');
      expect(userMessage.content).toContain('federal');
    });

    it('should include article, source norm, and sphere when available', async () => {
      const fullResult: SearchResult = {
        ...mockSearchResult,
        livro: 'LIVRO I',
        titulo: 'TÍTULO II',
        capitulo: 'CAPÍTULO III',
        secao: 'SEÇÃO IV',
      };

      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'query',
      });
      mockSearchLegislacao.mockResolvedValue([fullResult]);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      await askRAG(history);

      const callArgs = mockGroqCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      
      expect(userMessage.content).toContain('Art. 1º');
      expect(userMessage.content).toContain('rdc_67_2007.pdf');
      expect(userMessage.content).toContain('federal');
    });

    it('should handle empty search results', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'query',
      });
      mockSearchLegislacao.mockResolvedValue([]);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      const result = await askRAG(history);

      expect(result.sources).toEqual([]);
      expect(mockGroqCreate).not.toHaveBeenCalled();
      expect(result.answer).toContain('Não encontrei embasamento');
    });

    it('should use previous context when needsSearch is false', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta complementar' }];
      await askRAG(history);

      const callArgs = mockGroqCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMessage.content).toContain('Conteúdo do artigo legal.');
    });
  });

  it('reuses saved excerpts for formatting and searches again for technical follow-ups', async () => {
    mockAnalyzeAndNormalizeQuery.mockResolvedValue({ needsSearch: false, normalizedQuery: '' });
    mockGroqCreate.mockImplementation(async () => ({ [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: 'Resposta [1]' } }] };
    } }));
    const formatted = await askRAG([{ role: 'user', content: 'Resuma em tópicos' }], undefined, { evidence: [mockSearchResult] });
    expect(mockSearchLegislacao).not.toHaveBeenCalled();
    expect(formatted.evidence).toEqual([mockSearchResult]);
    expect(mockGroqCreate.mock.calls[0][0].messages.at(-1).content).toContain(mockSearchResult.content);
    await askRAG([{ role: 'user', content: 'E para armazenamento refrigerado?' }], undefined, { evidence: [mockSearchResult] });
    expect(mockSearchLegislacao).toHaveBeenCalledTimes(1);
  });

  describe('message ordering', () => {
    it('should send messages in correct order: system, history, current question', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Pergunta 1' },
        { role: 'assistant', content: 'Resposta 1' },
        { role: 'user', content: 'Pergunta 2' },
      ];

      await askRAG(history);

      const callArgs = mockGroqCreate.mock.calls[0][0];
      const messages = callArgs.messages;

      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Pergunta 1');
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('Resposta 1');
      expect(messages[3].role).toBe('user');
      expect(messages[3].content).toContain('Pergunta 2');
    });

    it('should preserve previous history messages', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [
        { role: 'user', content: 'Histórico 1' },
        { role: 'assistant', content: 'Resposta histórico 1' },
        { role: 'user', content: 'Pergunta atual' },
      ];

      await askRAG(history);

      const callArgs = mockGroqCreate.mock.calls[0][0];
      const messages = callArgs.messages;

      expect(messages.length).toBe(4);
      expect(messages[1].content).toBe('Histórico 1');
      expect(messages[2].content).toBe('Resposta histórico 1');
    });
  });

  describe('model configuration', () => {
    it('should use correct model and parameters', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      await askRAG(history);

      expect(mockGroqCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen/qwen3.8-27b',
          temperature: 0.1,
          max_tokens: 1000,
          stream: true,
        }), { signal: undefined }
      );
    });
  });

  describe('streaming and onChunk callback', () => {
    it('should accumulate all chunks into final answer', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      
      const chunks = ['Primeira parte ', 'segunda parte ', 'terceira parte.'];
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield { choices: [{ delta: { content: chunk } }] };
          }
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      const result = await askRAG(history);

      expect(result.answer).toBe('Primeira parte segunda parte terceira parte.');
    });

    it('should call onChunk callback for each chunk in order', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      
      const chunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];
      const onChunk = vi.fn();
      
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield { choices: [{ delta: { content: chunk } }] };
          }
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      await askRAG(history, onChunk);

      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Chunk 1');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'Chunk 2');
      expect(onChunk).toHaveBeenNthCalledWith(3, 'Chunk 3');
    });

    it('should work without onChunk callback', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta sem callback' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      const result = await askRAG(history);

      expect(result.answer).toBe('Resposta sem callback');
    });

    it('should handle empty stream', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          // Empty stream
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      const result = await askRAG(history);

      expect(result.answer).toBe('');
    });

    it('should handle stream creation error', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockRejectedValue(new Error('Stream creation failed'));

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      await expect(askRAG(history)).rejects.toThrow('Stream creation failed');
    });

    it('should handle stream iteration error', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: false,
        normalizedQuery: '',
      });
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Inicio' } }] };
          throw new Error('Iteration error');
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      await expect(askRAG(history)).rejects.toThrow('Iteration error');
    });
  });

  describe('return value', () => {
    it('should return answer, normalizedQuery, and sources', async () => {
      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'query normalizada',
      });
      mockSearchLegislacao.mockResolvedValue([mockSearchResult]);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta final' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      const result = await askRAG(history);

      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('normalizedQuery');
      expect(result).toHaveProperty('sources');
      expect(result.answer).toBe('Resposta final');
      expect(result.normalizedQuery).toBe('query normalizada');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toEqual({
        artigo: 'Art. 1º',
        score: 0.9,
        fonte: 'rdc_67_2007.pdf',
      });
    });

    it('should convert search results to sources correctly', async () => {
      const multipleResults: SearchResult[] = [
        { ...mockSearchResult, artigo: 'Art. 1º', score: 0.9, fonte_pdf: 'doc1.pdf' },
        { ...mockSearchResult, artigo: 'Art. 2º', score: 0.8, fonte_pdf: 'doc2.pdf' },
        { ...mockSearchResult, artigo: 'Art. 3º', score: 0.7, fonte_pdf: 'doc3.pdf' },
      ];

      mockAnalyzeAndNormalizeQuery.mockResolvedValue({
        needsSearch: true,
        normalizedQuery: 'query',
      });
      mockSearchLegislacao.mockResolvedValue(multipleResults);
      mockGroqCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Resposta' } }] };
        },
      });

      const history: ChatMessage[] = [{ role: 'user', content: 'Pergunta' }];
      const result = await askRAG(history);

      expect(result.sources).toHaveLength(3);
      expect(result.sources[0]).toEqual({ artigo: 'Art. 1º', score: 0.9, fonte: 'doc1.pdf' });
      expect(result.sources[1]).toEqual({ artigo: 'Art. 2º', score: 0.8, fonte: 'doc2.pdf' });
      expect(result.sources[2]).toEqual({ artigo: 'Art. 3º', score: 0.7, fonte: 'doc3.pdf' });
    });
  });
});