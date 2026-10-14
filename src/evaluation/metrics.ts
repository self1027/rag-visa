import type { SearchResult } from '../retriever/search.js';
export interface EvaluationCase { id: string; query: string; expectedSource: string | null; expectedArticle: string | null; expectedTerms: string[]; esfera?: 'municipal'; jurisdicao?: string }
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[º°]/g, '');
export function evaluateRetrieval(test: EvaluationCase, hits: SearchResult[]) {
  const expected = (hit: SearchResult) => !!test.expectedSource && normalize(hit.fonte_pdf).includes(normalize(test.expectedSource)) &&
    (!test.expectedArticle || normalize(hit.artigo) === normalize(test.expectedArticle));
  const rank = hits.findIndex(expected);
  return { found: rank >= 0, reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0,
    precisionAtK: hits.length ? hits.filter(expected).length / hits.length : 0,
    abstainedCorrectly: test.expectedSource === null ? hits.length === 0 : null };
}
export function evaluateAnswer(test: EvaluationCase, answer: string, sources: SearchResult[]) {
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  return { hasSourceIds: sources.length ? citations.length > 0 : null, citationValidity: citations.length ? citations.filter(id => id >= 1 && id <= sources.length).length / citations.length : null,
    termCoverage: test.expectedTerms.length ? test.expectedTerms.filter(term => normalize(answer).includes(normalize(term))).length / test.expectedTerms.length : null,
    refusedWithoutEvidence: !sources.length ? answer.includes('Não encontrei embasamento') : null };
}
