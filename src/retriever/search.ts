import { qdrantClient, COLLECTION_NAME } from '../config/qdrant.js';
import { generateEmbedding } from '../config/ollama.js';

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  esfera?: 'federal' | 'estadual' | 'municipal';
  artigo?: string;
}

export interface SearchResult {
  score: number;
  content: string;
  artigo: string;
  livro?: string | null;
  titulo?: string | null;
  capitulo?: string | null;
  secao?: string | null;
  esfera: 'federal' | 'estadual' | 'municipal';
  fonte_pdf: string;
}

export async function searchLegislacao(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 5, scoreThreshold = 0.3, esfera, artigo } = options;

  const queryVector = await generateEmbedding(query);
  const baseFilterMust: any[] = [];

  if (artigo) {
    baseFilterMust.push({ key: 'artigo', match: { value: artigo } });
  }

  // 1. General search (with the user's optional filters)
  if (esfera) {
    baseFilterMust.push({ key: 'esfera', match: { value: esfera } });
  }

  const baseFilter = baseFilterMust.length > 0 ? { must: baseFilterMust } : undefined;

  // Run the normal search
  const responseGeral = await qdrantClient.query(COLLECTION_NAME, {
    query: queryVector,
    limit,
    score_threshold: scoreThreshold,
    filter: baseFilter,
    with_payload: true,
  });

  const pointsGeral = responseGeral.points || responseGeral;

  // 2. Ensure a specific search for the municipal sphere (required to bring at least 1 municipal result)
  const municipalFilterMust = [...baseFilterMust];
  const indexEsfera = municipalFilterMust.findIndex(f => f.key === 'esfera');
  
  if (indexEsfera >= 0) {
    municipalFilterMust[indexEsfera] = { key: 'esfera', match: { value: 'municipal' } };
  } else {
    municipalFilterMust.push({ key: 'esfera', match: { value: 'municipal' } });
  }

  const responseMunicipal = await qdrantClient.query(COLLECTION_NAME, {
    query: queryVector,
    limit: 1, // Grab at least the best municipal result
    score_threshold: scoreThreshold,
    filter: { must: municipalFilterMust },
    with_payload: true,
  });

  const pointsMunicipal = responseMunicipal.points || responseMunicipal;

  // 3. Combine the results: ensure the municipal result makes it into the top/set
  const mapPoints = new Map();
  
  // Add the municipal result first (if it exists in the collection)
  pointsMunicipal.forEach((hit: any) => mapPoints.set(hit.id, hit));
  
  // Then fill the rest with the general search until the stipulated limit is reached
  pointsGeral.forEach((hit: any) => {
    if (mapPoints.size < limit) {
      mapPoints.set(hit.id, hit);
    }
  });

  const finalPoints = Array.from(mapPoints.values());

  return finalPoints.map((hit: any) => {
    const payload = (hit.payload || {}) as Record<string, any>;
    return {
      score: hit.score,
      content: payload.content,
      artigo: payload.artigo,
      livro: payload.livro ?? null,
      titulo: payload.titulo ?? null,
      capitulo: payload.capitulo ?? null,
      secao: payload.secao ?? null,
      esfera: payload.esfera,
      fonte_pdf: payload.fonte_pdf,
    };
  });
}