import { settings } from './settings.js';
import { QdrantClient } from '@qdrant/js-client-rest';

export const qdrantClient = new QdrantClient({
  url: settings.qdrantUrl,
  apiKey: settings.qdrantApiKey,
  timeout: settings.requestTimeoutMs,
});

export const COLLECTION_NAME = settings.collection;
export function getCollectionName() { return settings.collection; }

export async function setupQdrantCollection() {
  const COLLECTION_NAME = getCollectionName();
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some(
      (col) => col.name === COLLECTION_NAME
    );

    if (!exists) {
      console.log(`🚀 Criando coleção '${COLLECTION_NAME}' no Qdrant...`);
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: settings.embeddingDimensions,
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
