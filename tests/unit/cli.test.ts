import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock askRAG using vi.hoisted
const { mockAskRAG } = vi.hoisted(() => ({
  mockAskRAG: vi.fn(),
}));

vi.mock('../../src/rag/generator.js', () => ({
  askRAG: mockAskRAG,
  ChatMessage: {},
}));

// Mock readline/promises
const { MockReadlineInterface, mockQuestion, mockClose } = vi.hoisted(() => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  class MockReadlineInterface {
    question = mockQuestion;
    close = mockClose;
    input = process.stdin;
    output = process.stdout;
  }
  return { MockReadlineInterface, mockQuestion, mockClose };
});

vi.mock('readline/promises', () => {
  const createInterface = vi.fn(() => new MockReadlineInterface());
  return {
    createInterface,
    default: { createInterface },
  };
});

// Mock process.stdout.write
const { mockStdoutWrite } = vi.hoisted(() => ({
  mockStdoutWrite: vi.fn(),
}));

vi.mock('process', () => ({
  stdin: {},
  stdout: { write: mockStdoutWrite },
}));

import { runChatCLI } from '../../src/chat-cli.js';
// Import from the 'process' module (mocked above) so that writes go through
// mockStdoutWrite instead of the real process stdout
import { stdin, stdout } from 'process';

describe('chat-cli', () => {
  // tests/setup.ts replaces console.log with a global vi.fn(); the CLI prints
  // the welcome banner and sources via console.log, so we capture the calls here.
  function logCalls(): string[] {
    return vi.mocked(console.log).mock.calls.map((args) => args.join(' '));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockClose.mockResolvedValue(undefined);
    mockStdoutWrite.mockImplementation(() => {});
    mockQuestion.mockReset();
    mockAskRAG.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('initialization', () => {
    it('should display welcome message', async () => {
      mockQuestion.mockResolvedValueOnce('sair');
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta',
        normalizedQuery: 'query',
        sources: [],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      // The greeting is printed via console.log at CLI startup
      const welcome = logCalls().find((line) => line.includes('Assistente RAG'));
      expect(welcome).toBeDefined();
      expect(welcome).toContain('VISA');
    });
  });

  describe('exit conditions', () => {
    it('should exit on "sair"', async () => {
      mockQuestion.mockResolvedValueOnce('sair');
      
      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockClose).toHaveBeenCalled();
      expect(mockAskRAG).not.toHaveBeenCalled();
    });

    it('should exit on "SAIR" (case insensitive)', async () => {
      mockQuestion.mockResolvedValueOnce('SAIR');
      
      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should exit on "Sair" (mixed case)', async () => {
      mockQuestion.mockResolvedValueOnce('Sair');
      
      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should exit on empty input', async () => {
      mockQuestion.mockResolvedValueOnce('');
      
      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should exit on whitespace-only input', async () => {
      mockQuestion.mockResolvedValueOnce('   ');
      
      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('question processing', () => {
    it('should send question to askRAG', async () => {
      mockQuestion
        .mockResolvedValueOnce('Como armazenar alimentos?')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta do RAG',
        normalizedQuery: 'armazenamento alimentos',
        sources: [{ artigo: 'Art. 1º', score: 0.9, fonte: 'rdc.pdf' }],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      // The history array is the same live object used by the CLI, so the
      // assistant response is appended to it after the call.
      // We assert the question was sent (and was the first message).
      expect(mockAskRAG).toHaveBeenCalledWith(
        expect.arrayContaining([{ role: 'user', content: 'Como armazenar alimentos?' }]),
        expect.any(Function)
      );
      expect(mockAskRAG.mock.calls[0][0][0]).toEqual({
        role: 'user',
        content: 'Como armazenar alimentos?',
      });
    });

    it('should stream response chunks', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockImplementation(async (history, callback) => {
        callback('Chunk 1');
        callback('Chunk 2');
        return {
          answer: 'Chunk 1Chunk 2',
          normalizedQuery: 'query',
          sources: [],
        };
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockStdoutWrite).toHaveBeenCalledWith('Chunk 1');
      expect(mockStdoutWrite).toHaveBeenCalledWith('Chunk 2');
    });

    it('should add user question to history', async () => {
      mockQuestion
        .mockResolvedValueOnce('Primeira')
        .mockResolvedValueOnce('Segunda')
        .mockResolvedValueOnce('sair');
      
      // Snapshot the history at the time of each call (the array is live)
      const historySnapshots: Array<Array<{ role: string; content: string }>> = [];
      mockAskRAG.mockImplementation(async (history) => {
        historySnapshots.push([...history]);
        return {
          answer: 'Resposta',
          normalizedQuery: 'query',
          sources: [],
        };
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      // Structural comparison with exact order: question, answer, and new question
      expect(historySnapshots[1]).toEqual([
        { role: 'user', content: 'Primeira' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Segunda' },
      ]);
    });

    it('should add assistant response to history', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta da IA',
        normalizedQuery: 'query',
        sources: [],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      const calls = mockAskRAG.mock.calls;
      expect(calls[0][0]).toContainEqual(
        expect.objectContaining({ role: 'assistant', content: 'Resposta da IA' })
      );
    });

    it('should preserve history between questions', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta 1')
        .mockResolvedValueOnce('Pergunta 2')
        .mockResolvedValueOnce('sair');
      
      // The CLI always sends the SAME array reference (a live object), so we
      // copy the history state at the time of each call to be able to
      // compare the structure of each snapshot deterministically.
      const historySnapshots: Array<Array<{ role: string; content: string }>> = [];
      mockAskRAG.mockImplementation(async (history) => {
        historySnapshots.push([...history]);
        return {
          answer: 'Resposta',
          normalizedQuery: 'query',
          sources: [],
        };
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      // The first call only carries question 1; the second carries the full
      // history (question 1 + answer + question 2), preserved and in order.
      expect(historySnapshots[0]).toEqual([
        { role: 'user', content: 'Pergunta 1' },
      ]);
      expect(historySnapshots[1]).toEqual([
        { role: 'user', content: 'Pergunta 1' },
        { role: 'assistant', content: 'Resposta' },
        { role: 'user', content: 'Pergunta 2' },
      ]);
    });
  });

  describe('source display', () => {
    // The CLI formats each source as: " - Art. X [arquivo.pdf] (Relevância: NN.N%)"
    const formatSource = (s: { artigo: string; score: number; fonte: string }) =>
      ` - ${s.artigo} [${s.fonte}] (Relevância: ${(s.score * 100).toFixed(1)}%)`;

    it('should display sources after response', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta',
        normalizedQuery: 'query normalizada',
        sources: [
          { artigo: 'Art. 1º', score: 0.95, fonte: 'rdc_67_2007.pdf' },
          { artigo: 'Art. 2º', score: 0.87, fonte: 'lei_10083.pdf' },
        ],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      const logs = logCalls();
      expect(logs.some((line) => line.includes('📚 Fontes Consultadas:'))).toBe(true);
      expect(logs).toContain(formatSource({ artigo: 'Art. 1º', score: 0.95, fonte: 'rdc_67_2007.pdf' }));
      expect(logs).toContain(formatSource({ artigo: 'Art. 2º', score: 0.87, fonte: 'lei_10083.pdf' }));
    });

    it('should deduplicate sources', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta')
        .mockResolvedValueOnce('sair');
      
      // Deduplication uses the formatted string WITH relevance as the key, so
      // only identical entries (article, source and score) collapse into one line.
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta',
        normalizedQuery: 'query',
        sources: [
          { artigo: 'Art. 1º', score: 0.9, fonte: 'doc.pdf' },
          { artigo: 'Art. 1º', score: 0.9, fonte: 'doc.pdf' },
          { artigo: 'Art. 2º', score: 0.8, fonte: 'outro.pdf' },
        ],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      const sourceLines = logCalls().filter((line) => line.startsWith(' - '));
      expect(sourceLines).toEqual([
        formatSource({ artigo: 'Art. 1º', score: 0.9, fonte: 'doc.pdf' }),
        formatSource({ artigo: 'Art. 2º', score: 0.8, fonte: 'outro.pdf' }),
      ]);
    });

    it('should format relevance as percentage', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta',
        normalizedQuery: 'query',
        sources: [{ artigo: 'Art. 1º', score: 0.756, fonte: 'doc.pdf' }],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      const sourceLines = logCalls().filter((line) => line.startsWith(' - '));
      // (0.756 * 100).toFixed(1) === '75.6'
      expect(sourceLines).toEqual([' - Art. 1º [doc.pdf] (Relevância: 75.6%)']);
    });

    it('should handle empty sources', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta sem fontes',
        normalizedQuery: 'query',
        sources: [],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      const sourceLines = logCalls().filter((line) => line.startsWith(' - '));
      expect(sourceLines).toEqual([' - Nenhuma fonte referenciada.']);
    });
  });

  describe('error handling', () => {
    it('should display error and remove failed question from history', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta que falha')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockRejectedValue(new Error('Erro na API'));

      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockAskRAG).toHaveBeenCalledTimes(1);
    });

    it('should close readline on error', async () => {
      mockQuestion.mockResolvedValueOnce('Pergunta');
      mockAskRAG.mockRejectedValue(new Error('Erro'));

      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should continue after error', async () => {
      mockQuestion
        .mockResolvedValueOnce('Pergunta com erro')
        .mockResolvedValueOnce('Pergunta válida')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG
        .mockRejectedValueOnce(new Error('Erro'))
        .mockResolvedValueOnce({
          answer: 'Resposta válida',
          normalizedQuery: 'query',
          sources: [],
        });

      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockAskRAG).toHaveBeenCalledTimes(2);
    });
  });

  describe('readline cleanup', () => {
    it('should close readline on normal exit', async () => {
      mockQuestion.mockResolvedValueOnce('sair');
      
      await runChatCLI(stdin, stdout, mockAskRAG);
      
      expect(mockClose).toHaveBeenCalled();
    });

    it('should close readline on error', async () => {
      mockQuestion.mockResolvedValueOnce('Pergunta');
      mockAskRAG.mockRejectedValue(new Error('Erro'));
      
      await runChatCLI(stdin, stdout, mockAskRAG);
      
      expect(mockClose).toHaveBeenCalled();
    });

    it('should close readline in finally block', async () => {
      mockQuestion.mockRejectedValueOnce(new Error('Readline error'));
      
      try {
        await runChatCLI(stdin, stdout, mockAskRAG);
      } catch {}

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('ignoring whitespace messages', () => {
    it('should ignore messages with only spaces', async () => {
      mockQuestion
        .mockResolvedValueOnce('   ')
        .mockResolvedValueOnce('Pergunta real')
        .mockResolvedValueOnce('sair');
      
      mockAskRAG.mockResolvedValue({
        answer: 'Resposta',
        normalizedQuery: 'query',
        sources: [],
      });

      await runChatCLI(stdin, stdout, mockAskRAG);

      expect(mockAskRAG).toHaveBeenCalledTimes(1);
      expect(mockAskRAG).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'Pergunta real' })
        ]),
        expect.any(Function)
      );
    });
  });
});