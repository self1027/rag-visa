import { qdrantClient, COLLECTION_NAME } from './config/qdrant.js';

async function inspectQdrant() {
  console.log('🔍 Inspecionando a coleção do Qdrant...\n');

  try {
    const collectionInfo = await qdrantClient.getCollection(COLLECTION_NAME);
    console.log(`📊 Total de pontos indexados: ${collectionInfo.points_count}`);

    // Extração 100% tipada da dimensão do vetor
    const vectorsConfig = collectionInfo.config?.params?.vectors;
    let vectorSize: number | string = 'N/A';

    if (typeof vectorsConfig === 'object' && vectorsConfig !== null && 'size' in vectorsConfig && typeof vectorsConfig.size === 'number') {
    vectorSize = vectorsConfig.size;
    }

    console.log(`📐 Dimensão dos vetores: ${vectorSize}`);

    const samples = await qdrantClient.scroll(COLLECTION_NAME, {
      limit: 3,
      with_payload: true,
      with_vector: false,
    });

    console.log('\n📌 Amostra dos Chunks no Qdrant:');
    console.log(JSON.stringify(samples.points, null, 2));
  } catch (error) {
    console.error('❌ Erro ao conectar ou ler o Qdrant:', error);
  }
}

inspectQdrant();