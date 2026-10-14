import { it, expect } from 'vitest';
import { chunkLegislacao } from '../../src/utils/chunker.js';
import { extractPdf, locatePages } from '../../src/ingestion/pdf.js';
import { samplePdf } from '../fixtures/pdf.js';
it('keeps trailing hierarchy on the next article and resets lower levels', () => {
  const chunks = chunkLegislacao('LIVRO I\nTÍTULO I\nCAPÍTULO I\nSEÇÃO I\nArt. 1º Primeiro.\nCAPÍTULO II\nArt. 2º Segundo.\nLIVRO II\nArt. 3º Terceiro.', 'test.pdf');
  expect(chunks[0].metadata).toMatchObject({ livro: 'LIVRO I', capitulo: 'CAPÍTULO I', secao: 'SEÇÃO I' });
  expect(chunks[1].metadata).toMatchObject({ capitulo: 'CAPÍTULO II', secao: undefined });
  expect(chunks[2].metadata).toMatchObject({ livro: 'LIVRO II', titulo: undefined, capitulo: undefined, secao: undefined });
});
it('does not split inline article references into new articles', () => {
  const chunks = chunkLegislacao('Art. 1º Conforme art. 2º, inciso I.\nArt. 2º Outro.', 'test.pdf');
  expect(chunks).toHaveLength(2);
  expect(chunks[0].content).toContain('art. 2º, inciso I');
});
it('preserves actual page numbers from extracted PDF text', async () => {
  const extracted = await extractPdf(samplePdf());
  expect(extracted.pages).toHaveLength(2);
  const chunks = chunkLegislacao(extracted.text, 'test.pdf');
  expect(locatePages(chunks.at(-1)!.content, extracted.pages)).toMatchObject({ pagina: 2, paginaFim: 2 });
  expect(locatePages('text not found', extracted.pages)).toEqual({});
});
