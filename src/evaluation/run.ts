import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { searchLegislacao } from '../retriever/search.js';
import { askRAG } from '../rag/generator.js';
import { settings } from '../config/settings.js';
import { evaluateRetrieval, evaluateAnswer, type EvaluationCase } from './metrics.js';
async function run() {
  const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/evaluation/cases.json'), 'utf8')) as EvaluationCase[];
  const generate = process.argv.includes('--generate');
  const configurations = process.argv.includes('--grid') ? [
    { limit: 3, scoreThreshold: 0.3 }, { limit: 6, scoreThreshold: 0.3 }, { limit: 6, scoreThreshold: 0.5 },
  ] : [{ limit: settings.searchLimit, scoreThreshold: settings.searchThreshold }];
  const results = [];
  for (const config of configurations) {
    const rows = [];
    for (const test of cases) {
      const started = performance.now();
      const hits = await searchLegislacao(test.query, { ...config, esfera: test.esfera, jurisdicao: test.jurisdicao });
      const retrieval = evaluateRetrieval(test, hits);
      const response = generate ? await askRAG([{ role: 'user', content: test.query }], undefined,
        { search: { ...config, esfera: test.esfera, jurisdicao: test.jurisdicao } }) : undefined;
      rows.push({ id: test.id, ...retrieval, latencyMs: Math.round(performance.now() - started),
        sources: hits.map(hit => ({ fonte: hit.fonte_pdf, artigo: hit.artigo, score: hit.score })),
        answer: response?.answer, generationRetrieval: response ? evaluateRetrieval(test, response.evidence) : undefined, generation: response ? evaluateAnswer(test, response.answer, response.evidence) : undefined });
    }
    const positives = rows.filter(row => row.abstainedCorrectly === null);
    results.push({ configuration: config, recallAtK: positives.filter(row => row.found).length / positives.length,
      meanReciprocalRank: positives.reduce((sum, row) => sum + row.reciprocalRank, 0) / positives.length, rows });
  }
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(generate ? 'reports/rag-generation.json' : 'reports/rag-evaluation.json', JSON.stringify({ timestamp: new Date().toISOString(), model: settings.llmModel,
    note: 'Fixture inicial baseada nos PDFs locais. Validade de referências e cobertura lexical não medem correção jurídica ou suporte de cada afirmação; revisão especializada é necessária.', results }, null, 2));
  console.log(JSON.stringify(results.map(({ rows: _rows, ...summary }) => summary), null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
