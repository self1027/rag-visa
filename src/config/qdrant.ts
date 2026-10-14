import { settings } from './settings.js';
import { QdrantClient } from '@qdrant/js-client-rest';

export const qdrantClient = new QdrantClient({
  url: settings.qdrantUrl,
  timeout: settings.requestTimeoutMs,
});

export const COLLECTION_NAME = settings.collection;

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
          size: settings.embeddingDimensions, // Native dimension of bge-m3
          distance: 'Cosine',
        },
      });
      console.log(`Coleção '${COLLECTION_NAME}' criada com sucesso.`);
    } else {
      console.log(`Coleção '${COLLECTION_NAME}' já existe.`);
    }
  } catch (error) {
    console.error('❌ Erro ao configurar coleção no Qdrant:', error);
    throw error;
  }
}
