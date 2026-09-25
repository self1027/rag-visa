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

// Limite seguro em caracteres (~600 tokens) para evitar estouro de janela do modelo
const MAX_CHUNK_LENGTH = 2500;
const OVERLAP_LENGTH = 300;

/**
 * Divide textos que ultrapassam o limite de tamanho em sub-chunks menores
 * preservando o overlap e o cabeçalho de contexto.
 */
function splitLargeChunk(
  text: string,
  contextHeader: string,
  maxLength: number = MAX_CHUNK_LENGTH,
  overlap: number = OVERLAP_LENGTH
): string[] {
  const result: string[] = [];
  const headerPrefix = contextHeader ? `[${contextHeader}]\n` : '';
  const effectiveMax = maxLength - headerPrefix.length;

  let start = 0;
  while (start < text.length) {
    let end = start + effectiveMax;

    // Se não chegou ao fim do texto, busca a última quebra de linha para não cortar frases/parágrafos
    if (end < text.length) {
      const lastNewLine = text.lastIndexOf('\n', end);
      if (lastNewLine > start + effectiveMax * 0.5) {
        end = lastNewLine;
      }
    }

    const subText = text.slice(start, end).trim();
    if (subText.length > 0) {
      result.push(headerPrefix ? `${headerPrefix}${subText}` : subText);
    }

    if (end >= text.length) break;
    start = end - overlap;
  }

  return result;
}

export function chunkLegislacao(
  fullText: string,
  fileName: string
): DocumentChunk[] {
  // 1. Limpeza de ruídos de cabeçalho/rodapé e formatação de texto do PDF
  const cleanText = fullText
    .replace(/LEI N[°º].*?https?:\/\/\S+/gi, '')
    .replace(/\d+\s+of\s+\d+\s+\d{2}\/\d{2}\/\d{4}.*/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const fileLower = fileName.toLowerCase();
  const textLower = cleanText.slice(0, 1000).toLowerCase();

  // 2. Classificação de Esfera
  let esfera: 'estadual' | 'municipal' | 'federal' = 'municipal';
  if (fileLower.includes('rdc') || textLower.includes('anvisa') || textLower.includes('diretoria colegiada')) {
    esfera = 'federal';
  } else if (fileLower.includes('10083') || fileLower.includes('estadual') || textLower.includes('estado de são paulo')) {
    esfera = 'estadual';
  }

  // 3. Classificação do Tipo de Documento
  let tipoDocumento: 'legislacao' | 'modelo_notificacao' = 'legislacao';
  if (fileLower.includes('notificacao') || fileLower.includes('modelo') || textLower.includes('termo de notificação')) {
    tipoDocumento = 'modelo_notificacao';
  }

  // 4. Split por Artigo ou por Seções/Itens
  const articleRegex = /(?=\bArt(?:igo|\.)?\s*[\d\.\-\º°\^]+[A-Za-z]?)/i;
  let rawChunks = cleanText.split(articleRegex);

  if (rawChunks.length <= 1) {
    rawChunks = cleanText.split(/\n\n+/);
  }

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
    const matchLivro = trimmed.match(/(LIVRO\s+[I|V|X|L|C]+[^\n]*)/i);
    if (matchLivro) currentLivro = matchLivro[1].trim();

    const matchTitulo = trimmed.match(/(TÍTULO\s+[I|V|X|L|C]+[^\n]*)/i);
    if (matchTitulo) currentTitulo = matchTitulo[1].trim();

    const matchCapitulo = trimmed.match(/(CAPÍTULO\s+[I|V|X|L|C]+[^\n]*)/i);
    if (matchCapitulo) currentCapitulo = matchCapitulo[1].trim();

    const matchSecao = trimmed.match(/(SEÇÃO\s+[I|V|X|L|C]+[^\n]*)/i);
    if (matchSecao) currentSecao = matchSecao[1].trim();

    // Extrai e preserva a formatação exata do Artigo
    const matchArtigo = trimmed.match(/^Art(?:igo|\.)?\s*([\d\.\-\º°\^]+[A-Za-z]?)/i);
    let artigo = 'Geral/Introdução';

    if (matchArtigo) {
      const rawArtNumber = matchArtigo[1];
      artigo = `Art. ${rawArtNumber.replace(/[^\w\d\º°\-]/g, '')}`;
    }

    const contextHeader = [currentLivro, currentTitulo, currentCapitulo, currentSecao]
      .filter(Boolean)
      .join(' > ');

    const metadata = {
      artigo,
      livro: currentLivro || undefined,
      titulo: currentTitulo || undefined,
      capitulo: currentCapitulo || undefined,
      secao: currentSecao || undefined,
      tipo_documento: tipoDocumento,
      esfera,
      fonte_pdf: fileName,
    };

    // 5. Trava de Segurança: Se o texto do artigo exceder MAX_CHUNK_LENGTH, aplica o split secundário
    if (trimmed.length > MAX_CHUNK_LENGTH) {
      const subChunks = splitLargeChunk(trimmed, contextHeader);
      for (const subContent of subChunks) {
        chunks.push({
          content: subContent,
          metadata,
        });
      }
    } else {
      const enrichedContent = contextHeader
        ? `[${contextHeader}]\n${trimmed}`
        : trimmed;

      chunks.push({
        content: enrichedContent,
        metadata,
      });
    }
  }

  return chunks;
}