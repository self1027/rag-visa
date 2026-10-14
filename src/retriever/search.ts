import { qdrantClient, COLLECTION_NAME } from '../config/qdrant.js';
import { generateEmbedding } from '../config/ollama.js';
import { settings } from '../config/settings.js';
export interface SearchOptions {
  limit?: number; scoreThreshold?: number; esfera?: 'federal' | 'estadual' | 'municipal';
  artigo?: string; jurisdicao?: string; preferMunicipal?: boolean; signal?: AbortSignal;
}
export interface SearchResult {
  score: number; content: string; artigo: string;
  livro?: string | null; titulo?: string | null; capitulo?: string | null; secao?: string | null;
  esfera: 'federal' | 'estadual' | 'municipal'; fonte_pdf: string;
  id?: string | number; filename?: string; pagina?: number; paginaFim?: number;
  jurisdicao?: string | null; urlOficial?: string | null; vigencia?: string; versao?: string | null;
}
export async function searchLegislacao(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const { limit = settings.searchLimit, scoreThreshold = settings.searchThreshold, esfera, artigo, jurisdicao } = options;
  options.signal?.throwIfAborted();
  const vector = await generateEmbedding(query, options.signal);
  const must: any[] = [];
  if (artigo) must.push({ key: 'artigo', match: { value: artigo } });
  if (esfera) must.push({ key: 'esfera', match: { value: esfera } });
  // Local rules require a matching jurisdiction. Federal rules remain eligible.
  if (jurisdicao) must.push({ should: [
    { key: 'esfera', match: { value: 'federal' } },
    { key: 'jurisdicao', match: { any: [jurisdicao, jurisdicao.split('/').at(-1)!] } },
  ] });
  const must_not = [ { key: 'indexed', match: { value: false } }, { key: 'vigencia', match: { value: 'revogada' } } ];
  const response = await qdrantClient.query(COLLECTION_NAME, {
    query: vector, limit, score_threshold: scoreThreshold, filter: { must, must_not }, with_payload: true,
  });
  let points = response.points;
  if (options.preferMunicipal && jurisdicao && (!esfera || esfera === 'municipal')) {
    const municipal = await qdrantClient.query(COLLECTION_NAME, {
      query: vector, limit: 1, score_threshold: scoreThreshold,
      filter: { must: [...must, { key: 'esfera', match: { value: 'municipal' } }, { key: 'jurisdicao', match: { value: jurisdicao } }], must_not },
      with_payload: true,
    });
    points = [...new Map([...municipal.points, ...points].map(point => [point.id, point])).values()].slice(0, limit);
  }
  options.signal?.throwIfAborted();
  return points.filter(hit => typeof hit.payload?.content === 'string').map(hit => {
    const p = hit.payload as Record<string, any>;
    return {
      id: hit.id, score: hit.score, content: p.content, artigo: p.artigo || 'Geral/Introdução',
      livro: p.livro ?? null, titulo: p.titulo ?? null, capitulo: p.capitulo ?? null, secao: p.secao ?? null,
      esfera: p.esfera, fonte_pdf: p.fonte_pdf, filename: p.filename, pagina: p.pagina, paginaFim: p.paginaFim,
      jurisdicao: p.jurisdicao ?? null, urlOficial: p.url_oficial ?? null, vigencia: p.vigencia || 'desconhecida', versao: p.versao ?? null,
    };
  });
}
