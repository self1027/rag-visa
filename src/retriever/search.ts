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

  // 1. Busca Geral (com os filtros opcionais do usuário)
  if (esfera) {
    baseFilterMust.push({ key: 'esfera', match: { value: esfera } });
  }

  const baseFilter = baseFilterMust.length > 0 ? { must: baseFilterMust } : undefined;

  // Executa busca normal
  const responseGeral = await qdrantClient.query(COLLECTION_NAME, {
    query: queryVector,
    limit,
    score_threshold: scoreThreshold,
    filter: baseFilter,
    with_payload: true,
  });

  const pointsGeral = responseGeral.points || responseGeral;

  // 2. Garante a busca específica da esfera municipal (obrigatória para trazer pelo menos 1 municipal)
  const municipalFilterMust = [...baseFilterMust];
  const indexEsfera = municipalFilterMust.findIndex(f => f.key === 'esfera');
  
  if (indexEsfera >= 0) {
    municipalFilterMust[indexEsfera] = { key: 'esfera', match: { value: 'municipal' } };
  } else {
    municipalFilterMust.push({ key: 'esfera', match: { value: 'municipal' } });
  }

  const responseMunicipal = await qdrantClient.query(COLLECTION_NAME, {
    query: queryVector,
    limit: 1, // Pega pelo menos o melhor resultado municipal
    score_threshold: scoreThreshold,
    filter: { must: municipalFilterMust },
    with_payload: true,
  });

  const pointsMunicipal = responseMunicipal.points || responseMunicipal;

  // 3. Combina os resultados: garante que o resultado municipal entre no topo/conjunto
  const mapPoints = new Map();
  
  // Adiciona primeiro o resultado municipal (se existir na base)
  pointsMunicipal.forEach((hit: any) => mapPoints.set(hit.id, hit));
  
  // Depois preenche o resto com a busca geral até atingir o limite estipulado
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