import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { MockOllama, mockOllamaEmbeddings } = vi.hoisted(() => {
  const mockOllamaEmbeddings = vi.fn();
  class MockOllama {
    embeddings = mockOllamaEmbeddings;
  }
  return { MockOllama, mockOllamaEmbeddings };
});

vi.mock('ollama', () => ({
  Ollama: MockOllama,
}));

vi.mock('dotenv/config', () => ({}));

import { generateEmbedding } from '../../src/config/ollama.js';

describe('generateEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OLLAMA_URL = 'http://localhost:11434';
    mockOllamaEmbeddings.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should generate embedding for valid text', async () => {
    const mockEmbedding = Array(1024).fill(0).map((_, i) => i * 0.001);
    mockOllamaEmbeddings.mockResolvedValue({ embedding: mockEmbedding });
    
    const result = await generateEmbedding('texto de teste');
    
    expect(result).toEqual(mockEmbedding);
    expect(mockOllamaEmbeddings).toHaveBeenCalledWith({
      model: 'bge-m3',
      prompt: 'texto de teste',
      options: { num_ctx: 8192 },
    });
  });

  it('should trim whitespace from input text', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    mockOllamaEmbeddings.mockResolvedValue({ embedding: mockEmbedding });
    
    await generateEmbedding('  texto com espaços  ');
    
    expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'texto com espaços' })
    );
  });

  it('should throw for empty string', async () => {
    await expect(generateEmbedding('')).rejects.toThrow('O texto fornecido para geração de embedding está vazio.');
  });

  it('should throw for whitespace-only string', async () => {
    await expect(generateEmbedding('   \n\t  ')).rejects.toThrow('O texto fornecido para geração de embedding está vazio.');
  });

  it('should return correct vector from response', async () => {
    const expectedVector = [0.5, -0.3, 0.8, 0.1];
    mockOllamaEmbeddings.mockResolvedValue({ embedding: expectedVector });
    
    const result = await generateEmbedding('teste');
    
    expect(result).toEqual(expectedVector);
  });

  it('should use bge-m3 model', async () => {
    mockOllamaEmbeddings.mockResolvedValue({ embedding: [0.1] });
    
    await generateEmbedding('teste');
    
    expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'bge-m3' })
    );
  });

  it('should pass num_ctx option', async () => {
    mockOllamaEmbeddings.mockResolvedValue({ embedding: [0.1] });
    
    await generateEmbedding('teste');
    
    expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ options: { num_ctx: 8192 } })
    );
  });

  it('should propagate Ollama service errors', async () => {
    mockOllamaEmbeddings.mockRejectedValue(new Error('Connection refused'));
    
    await expect(generateEmbedding('teste')).rejects.toThrow('Connection refused');
  });

  it('should propagate other service errors', async () => {
    mockOllamaEmbeddings.mockRejectedValue(new Error('Model not found'));
    
    await expect(generateEmbedding('teste')).rejects.toThrow('Model not found');
  });

  it('should handle very long text', async () => {
    const longText = 'a'.repeat(10000);
    mockOllamaEmbeddings.mockResolvedValue({ embedding: [0.1] });
    
    const result = await generateEmbedding(longText);
    
    expect(result).toEqual([0.1]);
    expect(mockOllamaEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: longText })
    );
  });
});