import { QdrantClient } from '@qdrant/js-client-rest';

// Instância do cliente do Qdrant (ajusta a URL se o Docker estiver noutra porta/host)
export const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
});

export const COLLECTION_NAME = 'legislacao_visa';

/**
 * Garante que a coleção existe no Qdrant com as configurações corretas para o bge-m3
 */
export async function setupQdrantCollection() {
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some(
      (col) => col.name === COLLECTION_NAME
    );

    if (!exists) {
      console.log(`🚀 Criando coleção '${COLLECTION_NAME}' no Qdrant...`);
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 1024, // Dimensão nativa do bge-m3
          distance: 'Cosine',
        },
      });
      console.log(`✅ Coleção '${COLLECTION_NAME}' criada com sucesso.`);
    } else {
      console.log(`ℹ️ Coleção '${COLLECTION_NAME}' já existe.`);
    }
  } catch (error) {
    console.error('❌ Erro ao configurar coleção no Qdrant:', error);
    throw error;
  }
}