import { Ollama } from 'ollama';

export const ollamaClient = new Ollama({
  host: process.env.OLLAMA_URL || 'http://localhost:11434',
});

const EMBEDDING_MODEL = 'bge-m3';

/**
 * Gera o vetor de embeddings para um determinado texto usando o bge-m3
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollamaClient.embeddings({
      model: EMBEDDING_MODEL,
      prompt: text,
    });
    return response.embedding;
  } catch (error) {
    console.error(`❌ Erro ao gerar embedding para o texto: "${text.slice(0, 30)}..."`, error);
    throw error;
  }
}