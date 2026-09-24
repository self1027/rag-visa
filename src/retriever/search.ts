import { qdrantClient, COLLECTION_NAME } from '../config/qdrant.js';
import { generateEmbedding } from '../config/ollama.js';

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  esfera?: 'estadual' | 'municipal';
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
  esfera: string;
  fonte_pdf: string;
}

export async function searchLegislacao(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 5, scoreThreshold = 0.3, esfera, artigo } = options;

  const queryVector = await generateEmbedding(query);
  const filterMust: any[] = [];

  if (esfera) {
    filterMust.push({ key: 'esfera', match: { value: esfera } });
  }

  if (artigo) {
    filterMust.push({ key: 'artigo', match: { value: artigo } });
  }

  const filter = filterMust.length > 0 ? { must: filterMust } : undefined;

  // Executa busca via método universal query() da SDK moderna
  const response = await qdrantClient.query(COLLECTION_NAME, {
    query: queryVector,
    limit,
    score_threshold: scoreThreshold,
    filter,
    with_payload: true,
  });

  const points = response.points || response;

  return points.map((hit: any) => {
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