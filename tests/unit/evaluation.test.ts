import { it, expect } from 'vitest';
import { evaluateRetrieval, evaluateAnswer } from '../../src/evaluation/metrics.js';
const test = { id: 'test', query: 'query', expectedSource: 'Norma', expectedArticle: 'Art. 1', expectedTerms: ['resíduos'] };
const hit = { content: 'text', fonte_pdf: 'Norma', artigo: 'Art. 1º', esfera: 'federal' as const, score: 0.8 };
it('measures expected source rank and detects invalid reference IDs', () => {
  expect(evaluateRetrieval(test, [{ ...hit, fonte_pdf: 'Other' }, hit])).toMatchObject({ found: true, reciprocalRank: 0.5, precisionAtK: 0.5 });
  expect(evaluateAnswer(test, 'Resíduos [1] [9]', [hit])).toMatchObject({ citationValidity: 0.5, termCoverage: 1 });
});
it('measures abstention separately from positive retrieval', () => {
  expect(evaluateRetrieval({ ...test, expectedSource: null }, [])).toMatchObject({ abstainedCorrectly: true });
});
