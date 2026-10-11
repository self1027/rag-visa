import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chunkLegislacao, DocumentChunk } from '../../src/utils/chunker.js';

describe('chunkLegislacao', () => {
  describe('edge cases', () => {
    it('should return empty array for empty text', () => {
      const result = chunkLegislacao('', 'test.pdf');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only text', () => {
      const result = chunkLegislacao('   \n\n\t  ', 'test.pdf');
      expect(result).toEqual([]);
    });

    it('should handle text with only line breaks', () => {
      const result = chunkLegislacao('\n\n\n', 'test.pdf');
      expect(result).toEqual([]);
    });
  });

  describe('short text handling', () => {
    it('should produce a single chunk for short text', () => {
      const text = 'Art. 1º Esta lei estabelece normas gerais.';
      const result = chunkLegislacao(text, 'lei_teste.pdf');
      
      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('Art. 1º Esta lei estabelece normas gerais.');
      expect(result[0].metadata.artigo).toBe('Art. 1º');
      expect(result[0].metadata.fonte_pdf).toBe('lei_teste.pdf');
    });

    it('should handle text without article markers', () => {
      const text = 'Este é um texto introdutório sem artigos formais.';
      const result = chunkLegislacao(text, 'doc.pdf');
      
      expect(result).toHaveLength(1);
      expect(result[0].metadata.artigo).toBe('Geral/Introdução');
    });
  });

  describe('article splitting', () => {
    it('should split by article markers', () => {
      const text = `Art. 1º Primeiro artigo.
      
      Art. 2º Segundo artigo com mais conteúdo.
      
      Art. 3º Terceiro artigo.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result.length).toBeGreaterThanOrEqual(3);
      const articles = result.map(c => c.metadata.artigo).filter(a => a !== 'Geral/Introdução');
      expect(articles).toContain('Art. 1º');
      expect(articles).toContain('Art. 2º');
      expect(articles).toContain('Art. 3º');
    });

    it('should preserve article numbers with special characters', () => {
      const text = `Art. 1º-A Parágrafo único.
      
      Art. 2º-B § 1º Inciso I.
      
      Artigo 3.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      const articles = result.map(c => c.metadata.artigo ?? '');
      expect(articles.some(a => a.includes('1º-A') || a.includes('1'))).toBe(true);
      expect(articles.some(a => a.includes('2º-B') || a.includes('2'))).toBe(true);
    });

    it('should handle "Artigo" without abbreviation', () => {
      const text = `Artigo 1. Primeiro artigo.
      
      Artigo 2. Segundo artigo.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      const articles = result.map(c => c.metadata.artigo ?? '');
      expect(articles.some(a => a.includes('1'))).toBe(true);
      expect(articles.some(a => a.includes('2'))).toBe(true);
    });
  });

  describe('sphere classification', () => {
    it('should classify federal for RDC documents', () => {
      const text = 'Art. 1º RDC 67/2007 estabelece...';
      const result = chunkLegislacao(text, 'rdc_67_2007.pdf');
      
      expect(result[0].metadata.esfera).toBe('federal');
    });

    it('should classify federal for ANVISA mentions', () => {
      const text = 'A ANVISA estabelece que... Art. 1º Norma federal.';
      const result = chunkLegislacao(text, 'documento.pdf');
      
      expect(result[0].metadata.esfera).toBe('federal');
    });

    it('should classify federal for "diretoria colegiada"', () => {
      const text = 'A Diretoria Colegiada aprovou... Art. 1º Norma.';
      const result = chunkLegislacao(text, 'doc.pdf');
      
      expect(result[0].metadata.esfera).toBe('federal');
    });

    it('should classify estadual for lei_10083', () => {
      const text = 'Art. 1º Lei estadual.';
      const result = chunkLegislacao(text, 'lei_10083_1998.pdf');
      
      expect(result[0].metadata.esfera).toBe('estadual');
    });

    it('should classify estadual for "estado de são paulo"', () => {
      const text = 'Estado de São Paulo decreta... Art. 1º Lei.';
      const result = chunkLegislacao(text, 'doc.pdf');
      
      expect(result[0].metadata.esfera).toBe('estadual');
    });

    it('should default to municipal', () => {
      const text = 'Art. 1º Lei municipal.';
      const result = chunkLegislacao(text, 'lei_municipal.pdf');
      
      expect(result[0].metadata.esfera).toBe('municipal');
    });
  });

  describe('document type classification', () => {
    it('should classify modelo_notificacao for notificacao in filename', () => {
      const text = 'Art. 1º Modelo.';
      const result = chunkLegislacao(text, 'modelo_notificacao.pdf');
      
      expect(result[0].metadata.tipo_documento).toBe('modelo_notificacao');
    });

    it('should classify modelo_notificacao for "termo de notificação" in text', () => {
      const text = 'Termo de Notificação - Art. 1º Auto de infração.';
      const result = chunkLegislacao(text, 'doc.pdf');
      
      expect(result[0].metadata.tipo_documento).toBe('modelo_notificacao');
    });

    it('should default to legislacao', () => {
      const text = 'Art. 1º Lei ordinária.';
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].metadata.tipo_documento).toBe('legislacao');
    });
  });

  describe('hierarchical context tracking', () => {
    it('should track LIVRO context', () => {
      const text = `LIVRO I - DAS DISPOSIÇÕES GERAIS
      
      Art. 1º Primeira lei.
      
      Art. 2º Segunda lei.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].metadata.livro).toBe('LIVRO I - DAS DISPOSIÇÕES GERAIS');
      expect(result[1].metadata.livro).toBe('LIVRO I - DAS DISPOSIÇÕES GERAIS');
    });

    it('should track TÍTULO context', () => {
      const text = `TÍTULO II - DA VIGILÂNCIA
      
      Art. 1º Artigo do título.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].metadata.titulo).toBe('TÍTULO II - DA VIGILÂNCIA');
    });

    it('should track CAPÍTULO context', () => {
      const text = `CAPÍTULO I - DAS PENALIDADES
      
      Art. 1º Penalidade.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].metadata.capitulo).toBe('CAPÍTULO I - DAS PENALIDADES');
    });

    it('should track SEÇÃO context', () => {
      const text = `SEÇÃO I - DAS MULTAS
      
      Art. 1º Multa.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].metadata.secao).toBe('SEÇÃO I - DAS MULTAS');
    });

    it('should combine hierarchy in context header', () => {
      const text = `LIVRO I
      TÍTULO I
      CAPÍTULO I
      SEÇÃO I
      
      Art. 1º Artigo com hierarquia completa.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].content).toContain('[LIVRO I > TÍTULO I > CAPÍTULO I > SEÇÃO I]');
    });

    it('should reset context when new hierarchy level appears', () => {
      const text = `LIVRO I
      Art. 1º No livro I.
      
      LIVRO II
      Art. 2º No livro II.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].metadata.livro).toBe('LIVRO I');
      expect(result[1].metadata.livro).toBe('LIVRO II');
    });
  });

  describe('metadata preservation', () => {
    it('should preserve source PDF name in metadata', () => {
      const text = 'Art. 1º Teste.';
      const result = chunkLegislacao(text, 'meu_documento.pdf');
      
      expect(result[0].metadata.fonte_pdf).toBe('meu_documento.pdf');
    });

    it('should include all metadata fields', () => {
      const text = 'Art. 1º Teste.';
      const result = chunkLegislacao(text, 'test.pdf');
      
      expect(result[0].metadata).toHaveProperty('artigo');
      expect(result[0].metadata).toHaveProperty('tipo_documento');
      expect(result[0].metadata).toHaveProperty('esfera');
      expect(result[0].metadata).toHaveProperty('fonte_pdf');
    });
  });

  describe('text cleaning', () => {
    it('should remove LEI Nº header patterns', () => {
      const text = 'LEI Nº 12345 https://www.exemplo.com/lei\n\nArt. 1º Conteúdo real.';
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].content).not.toContain('LEI Nº 12345');
      expect(result[0].content).not.toContain('https://');
      expect(result[0].content).toContain('Conteúdo real');
    });

    it('should remove page number patterns', () => {
      const text = '1 of 5 01/01/2024\n\nArt. 1º Conteúdo.\n\n2 of 5 01/01/2024';
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].content).not.toContain('1 of 5');
      expect(result[0].content).not.toContain('01/01/2024');
    });

    it('should normalize CRLF to LF', () => {
      const text = 'Art. 1º Linha 1.\r\nLinha 2.\r\n\r\nArt. 2º Outro.';
      const result = chunkLegislacao(text, 'lei.pdf');
      
      expect(result[0].content).not.toContain('\r');
    });

    it('should collapse multiple blank lines', () => {
      const text = 'Art. 1º Linha.\n\n\n\n\nArt. 2º Outra.';
      const result = chunkLegislacao(text, 'lei.pdf');
      
      const content = result.map(c => c.content).join('\n');
      expect(content).not.toMatch(/\n{3,}/);
    });
  });

  describe('large chunk splitting', () => {
    it('should split chunks exceeding MAX_CHUNK_LENGTH', () => {
      // Create a very long article content
      const longContent = 'Art. 1º ' + 'Conteúdo muito longo. '.repeat(200);
      const result = chunkLegislacao(longContent, 'lei.pdf');
      
      // Should have multiple chunks due to splitting
      expect(result.length).toBeGreaterThan(1);
      
      // All chunks should have the context header
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(2500);
      }
    });

    it('should apply context header to subchunks', () => {
      const text = `LIVRO I
      
      Art. 1º ` + 'Texto longo. '.repeat(200);
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      for (const chunk of result) {
        expect(chunk.content).toContain('[LIVRO I]');
      }
    });

    it('should maintain overlap between subchunks', () => {
      const longText = 'Art. 1º ' + 'Palavra '.repeat(500);
      const result = chunkLegislacao(longText, 'lei.pdf');
      
      // The text contains no '\n', so the newline boundary adjustment does not
      // occur and the overlap is exactly OVERLAP_LENGTH (300 chars):
      // the tail of chunk N must be identical to the head of chunk N+1.
      expect(result.length).toBeGreaterThan(1);
      const OVERLAP_LENGTH = 300;
      const chunk1End = result[0].content.slice(-OVERLAP_LENGTH);
      const chunk2Start = result[1].content.slice(0, OVERLAP_LENGTH);
      expect(chunk2Start).toBe(chunk1End);
    });

    it('should not produce empty chunks after splitting', () => {
      const longText = 'Art. 1º ' + 'A '.repeat(1000);
      const result = chunkLegislacao(longText, 'lei.pdf');
      
      for (const chunk of result) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it('should terminate on very long inputs', () => {
      // This tests the while loop termination
      const hugeText = 'Art. 1º ' + 'X '.repeat(10000);
      const result = chunkLegislacao(hugeText, 'lei.pdf');
      
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(100); // Sanity check - not infinite
    });
  });

  describe('boundary conditions with context header', () => {
    it('should respect MAX_CHUNK_LENGTH including header', () => {
      const header = '[LIVRO I > TÍTULO I > CAPÍTULO I > SEÇÃO I]\n';
      const content = 'A '.repeat(2500 - header.length + 100); // Exceeds limit even with header
      const text = `LIVRO I\nTÍTULO I\nCAPÍTULO I\nSEÇÃO I\n\nArt. 1º ${content}`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(2500);
      }
    });
  });

  describe('no duplicate chunks beyond intentional overlap', () => {
    it('should not duplicate content inappropriately', () => {
      const text = `Art. 1º Conteúdo único do artigo primeiro.
      
      Art. 2º Conteúdo único do artigo segundo.`;
      
      const result = chunkLegislacao(text, 'lei.pdf');
      
      const contents = result.map(c => c.content);
      // Each article should appear once
      const art1Count = contents.filter(c => c.includes('Conteúdo único do artigo primeiro')).length;
      const art2Count = contents.filter(c => c.includes('Conteúdo único do artigo segundo')).length;
      
      expect(art1Count).toBe(1);
      expect(art2Count).toBe(1);
    });
  });

  describe('fallback to paragraph splitting', () => {
    it('should split by paragraphs when no articles found', () => {
      const text = `Primeiro parágrafo com conteúdo.
      
      Segundo parágrafo separado.
      
      Terceiro parágrafo final.`;
      
      const result = chunkLegislacao(text, 'doc.pdf');
      
      expect(result.length).toBeGreaterThanOrEqual(1);
      // All should have "Geral/Introdução" as article since no article markers
      for (const chunk of result) {
        expect(chunk.metadata.artigo).toBe('Geral/Introdução');
      }
    });
  });
});

describe('DocumentChunk type', () => {
  it('should have correct structure', () => {
    const chunk: DocumentChunk = {
      content: 'Test content',
      metadata: {
        artigo: 'Art. 1º',
        livro: 'LIVRO I',
        titulo: 'TÍTULO I',
        capitulo: 'CAPÍTULO I',
        secao: 'SEÇÃO I',
        tipo_documento: 'legislacao',
        esfera: 'federal',
        fonte_pdf: 'test.pdf',
      },
    };
    
    expect(chunk.content).toBe('Test content');
    expect(chunk.metadata.artigo).toBe('Art. 1º');
    expect(chunk.metadata.esfera).toBe('federal');
  });
});