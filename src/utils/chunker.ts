export interface DocumentChunk {
  content: string;
  metadata: {
    artigo?: string;
    livro?: string;
    titulo?: string;
    capitulo?: string;
    secao?: string;
    tipo_documento: 'legislacao' | 'modelo_notificacao';
    esfera: 'estadual' | 'municipal' | 'federal';
    fonte_pdf: string;
  };
}

export function chunkLegislacao(
  fullText: string,
  fileName: string
): DocumentChunk[] {
  // 1. Limpeza de ruídos de cabeçalho/rodapé e formatação de texto do PDF
  const cleanText = fullText
    .replace(/LEI N[°º].*?https?:\/\/\S+/gi, '') // Remove cabeçalhos/links do PDF
    .replace(/\d+\s+of\s+\d+\s+\d{2}\/\d{2}\/\d{4}.*/gi, '') // Remove numeração de página ("3 of 20 23/09/2026...")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  let esfera: 'estadual' | 'municipal' | 'federal' = 'municipal';
  if (fileName.toLowerCase().includes('10083') || fileName.toLowerCase().includes('estadual')) {
    esfera = 'estadual';
  }

  // 2. Regex aprimorado para capturar variações de "Artigo", "Art.", ordinais e numerações
  const articleRegex = /(?=\bArt(?:igo|\.)?\s*\$?[\d\.\-\º°\^]+)/i;
  const rawChunks = cleanText.split(articleRegex);
  
  const chunks: DocumentChunk[] = [];
  
  // Variáveis para rastreamento de contexto hierárquico
  let currentLivro = '';
  let currentTitulo = '';
  let currentCapitulo = '';
  let currentSecao = '';

  for (const rawChunk of rawChunks) {
    const trimmed = rawChunk.trim();
    if (trimmed.length < 15) continue;

    // Atualiza o contexto da hierarquia legal se presente no segmento
    const matchLivro = trimmed.match(/(LIVRO\s+[I|V|X]+)/i);
    if (matchLivro) currentLivro = matchLivro[1];

    const matchTitulo = trimmed.match(/(TÍTULO\s+[I|V|X]+)/i);
    if (matchTitulo) currentTitulo = matchTitulo[1];

    const matchCapitulo = trimmed.match(/(CAPÍTULO\s+[I|V|X]+)/i);
    if (matchCapitulo) currentCapitulo = matchCapitulo[1];

    const matchSecao = trimmed.match(/(SEÇÃO\s+[I|V|X]+)/i);
    if (matchSecao) currentSecao = matchSecao[1];

    // Extrai a identificação exata do Artigo
    const matchArtigo = trimmed.match(/^Art(?:igo|\.)?\s*\$?([\d\.\-\º°\^]+)/i);
    const artigo = matchArtigo ? `Art. ${matchArtigo[1].replace(/[^\d]/g, '')}` : 'Geral/Introdução';

    // Concatena a hierarquia no conteúdo para reforço semântico dos embeddings
    const contextHeader = [currentLivro, currentTitulo, currentCapitulo, currentSecao]
      .filter(Boolean)
      .join(' > ');

    const enrichedContent = contextHeader 
      ? `[${contextHeader}]\n${trimmed}` 
      : trimmed;

    chunks.push({
      content: enrichedContent,
      metadata: {
        artigo,
        livro: currentLivro || undefined,
        titulo: currentTitulo || undefined,
        capitulo: currentCapitulo || undefined,
        secao: currentSecao || undefined,
        tipo_documento: 'legislacao',
        esfera,
        fonte_pdf: fileName,
      },
    });
  }

  return chunks;
}