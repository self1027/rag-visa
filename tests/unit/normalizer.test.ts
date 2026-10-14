import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define the mock function before vi.mock factory is evaluated
const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() };
});

// Mock OpenAI with the mock function from vi.hoisted
vi.mock('openai', () => {
  class MockOpenAI {
    chat: { completions: { create: typeof mockCreate } };
    constructor() {
      this.chat = {
        completions: {
          create: mockCreate,
        },
      };
    }
  }
  return {
    default: MockOpenAI,
  };
});

vi.mock('dotenv/config', () => ({}));

import { analyzeAndNormalizeQuery, AnalysisResult } from '../../src/rag/normalizer.js';

describe('analyzeAndNormalizeQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-key';
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('single message history (directNormalize path)', () => {
    it('should call directNormalize for single message history', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'consulta técnica normalizada' } }],
      });

      const history = [{ role: 'user', content: 'Como armazenar alimentos?' }];
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('consulta técnica normalizada');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should fallback to original question if directNormalize fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API Error'));

      const history = [{ role: 'user', content: 'Pergunta original' }];
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('Pergunta original');
    });

    it('should use original question if directNormalize returns too long result', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'x'.repeat(250) } }],
      });

      const history = [{ role: 'user', content: 'Pergunta curta' }];
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.normalizedQuery).toBe('Pergunta curta');
    });
  });

  describe('multi-message history (router path)', () => {
    it('should return needs_search true for new technical question', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: true,
              normalized_query: 'armazenamento alimentos RDC 216'
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Olá' },
        { role: 'assistant', content: 'Olá! Como posso ajudar?' },
        { role: 'user', content: 'Como armazenar alimentos segundo a RDC 216?' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('armazenamento alimentos RDC 216');
    });

    it('should return needs_search false for greeting', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: false,
              normalized_query: ''
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Olá' },
        { role: 'assistant', content: 'Olá!' },
        { role: 'user', content: 'Bom dia' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(false);
      expect(result.normalizedQuery).toBe('');
    });

    it('should return needs_search false for courtesy', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: false,
              normalized_query: ''
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Qual a RDC para alimentos?' },
        { role: 'assistant', content: 'A RDC 216...' },
        { role: 'user', content: 'Obrigado!' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(false);
      expect(result.normalizedQuery).toBe('');
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '```json\n{"needs_search": true, "normalized_query": "teste markdown"}\n```'
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Nova pergunta' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('teste markdown');
    });

    it('should handle empty response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Nova' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('Nova');
    });

    it('should handle invalid JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'not json at all' } }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Nova pergunta' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('Nova pergunta');
    });

    it('should handle API exception and fallback', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network error'));

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Pergunta que falha' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.needsSearch).toBe(true);
      expect(result.normalizedQuery).toBe('Pergunta que falha');
    });

    it('should truncate normalized query if too long (>200 chars)', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: true,
              normalized_query: 'x'.repeat(250)
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Nova' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.normalizedQuery).toBe('Nova');
    });

    it('should fallback if normalized query contains "Aqui está"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: true,
              normalized_query: 'Aqui está a consulta normalizada'
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Pergunta real' }
      ];
      
      const result = await analyzeAndNormalizeQuery(history);

      expect(result.normalizedQuery).toBe('Pergunta real');
    });
  });

  describe('edge cases', () => {
    it('should handle empty history array', async () => {
      const history: Array<{ role: string; content: string }> = [];
      
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'fallback' } }],
      });

      const result = await analyzeAndNormalizeQuery(history);
      
      expect(result.needsSearch).toBe(true);
      expect(typeof result.normalizedQuery).toBe('string');
    });

    it('should handle missing last message in history', async () => {
      const history = [
        { role: 'assistant', content: 'Resposta sem pergunta anterior' }
      ];
      
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'fallback' } }],
      });

      const result = await analyzeAndNormalizeQuery(history);
      
      expect(result.needsSearch).toBe(true);
    });

    it('should verify model and parameters sent to API', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: true,
              normalized_query: 'teste'
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta anterior' },
        { role: 'user', content: 'Nova pergunta técnica' }
      ];
      
      await analyzeAndNormalizeQuery(history);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen/qwen3.8-27b',
          temperature: 0.0,
          max_tokens: 150,
          response_format: { type: 'json_object' },
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        }), { signal: undefined }
      );
    });

    it('should verify directNormalize model and parameters', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'normalizado' } }],
      });

      const history = [{ role: 'user', content: 'Pergunta única' }];
      
      await analyzeAndNormalizeQuery(history);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen/qwen3.8-27b',
          temperature: 0.0,
          max_tokens: 60,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: expect.stringContaining('Vigilância Sanitária') }),
            expect.objectContaining({ role: 'user', content: 'Pergunta única' }),
          ]),
        }), { signal: undefined }
      );
    });
  });

  describe('return type', () => {
    it('should return AnalysisResult interface', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              needs_search: true,
              normalized_query: 'teste'
            })
          }
        }],
      });

      const history = [
        { role: 'user', content: 'Anterior' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Nova' }
      ];
      
      const result: AnalysisResult = await analyzeAndNormalizeQuery(history);

      expect(result).toHaveProperty('needsSearch');
      expect(result).toHaveProperty('normalizedQuery');
      expect(typeof result.needsSearch).toBe('boolean');
      expect(typeof result.normalizedQuery).toBe('string');
    });
  });
});