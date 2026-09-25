import { Ollama } from 'ollama';

export const ollamaClient = new Ollama({
  host: process.env.OLLAMA_URL || 'http://localhost:11434',
});

const EMBEDDING_MODEL = 'bge-m3';

export async function generateEmbedding(text: string): Promise<number[]> {
  const cleanText = text?.trim();

  if (!cleanText) {
    throw new Error('O texto fornecido para geração de embedding está vazio.');
  }

  try {
    const response = await ollamaClient.embeddings({
      model: EMBEDDING_MODEL,
      prompt: cleanText,
      options: {
        num_ctx: 8192,
      },
    });

    return response.embedding;
  } catch (error) {
    console.error(
      `Erro ao gerar embedding para o texto: "${cleanText.slice(0, 30)}..."`,
      error
    );
    throw error;
  }
}