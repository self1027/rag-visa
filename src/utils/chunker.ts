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

// Safe limit in characters (~600 tokens) to avoid overflowing the model's context window
const MAX_CHUNK_LENGTH = 2500;
const OVERLAP_LENGTH = 300;

/**
 * Splits texts that exceed the size limit into smaller sub-chunks
 * while preserving the overlap and the context header.
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

    // If not at the end of the text, look for the last line break to avoid cutting sentences/paragraphs
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

// Regex to capture roman numerals (ordered from longest to shortest)
const ROMAN_NUMERAL = '(?:IV|IX|XL|XC|CD|CM|I|V|X|L|C)+';

// Regex for hierarchical headers - only matches at the start of a line or of the text
// (with the global flag). Indentation spaces/tabs are tolerated, because PDF text
// extraction frequently preserves the indentation of the titles.
const HIERARCHY_REGEX = new RegExp(`(?:^|\\n)[ \\t]*(${['LIVRO', 'TÍTULO', 'CAPÍTULO', 'SEÇÃO'].map(h => `${h}\\s+${ROMAN_NUMERAL}[^\\n.]*`).join('|')})`, 'gi');

export function chunkLegislacao(
  fullText: string,
  fileName: string
): DocumentChunk[] {
  // 1. Clean up header/footer noise and PDF text formatting
  const cleanText = fullText
    .replace(/LEI N[°º].*?https?:\/\/\S+/gi, '')
    .replace(/\d+\s+of\s+\d+\s+\d{2}\/\d{2}\/\d{4}.*/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const fileLower = fileName.toLowerCase();
  const textLower = cleanText.slice(0, 1000).toLowerCase();

  // 2. Sphere Classification
  let esfera: 'estadual' | 'municipal' | 'federal' = 'municipal';
  if (fileLower.includes('rdc') || textLower.includes('anvisa') || textLower.includes('diretoria colegiada')) {
    esfera = 'federal';
  } else if (fileLower.includes('10083') || fileLower.includes('estadual') || textLower.includes('estado de são paulo')) {
    esfera = 'estadual';
  }

  // 3. Document Type Classification
  let tipoDocumento: 'legislacao' | 'modelo_notificacao' = 'legislacao';
  if (fileLower.includes('notificacao') || fileLower.includes('modelo') || textLower.includes('termo de notificação')) {
    tipoDocumento = 'modelo_notificacao';
  }

  // 4. Split by Article or by Sections/Items
  const articleRegex = /(?=\bArt(?:igo|\.)?\s*[\d\.\-\º°\^]+[A-Za-z]?)/i;
  let rawChunks = cleanText.split(articleRegex);

  if (rawChunks.length <= 1) {
    rawChunks = cleanText.split(/\n\n+/);
  }

  const chunks: DocumentChunk[] = [];

  // Variables for tracking hierarchical context
  let currentLivro = '';
  let currentTitulo = '';
  let currentCapitulo = '';
  let currentSecao = '';

  for (const rawChunk of rawChunks) {
    const trimmed = rawChunk.trim();
    // Allow shorter chunks for hierarchy headers (LIVRO, TÍTULO, etc.)
    if (trimmed.length < 3) continue;

    // Check for hierarchy headers BEFORE processing the chunk
    // Only match at start of text or after newline to avoid matching in article text
    // Reset regex lastIndex for each use
    HIERARCHY_REGEX.lastIndex = 0;
    const hierarchyMatches = trimmed.matchAll(HIERARCHY_REGEX);
    for (const match of hierarchyMatches) {
      const header = match[1].trim();
      if (header.startsWith('LIVRO')) currentLivro = header;
      else if (header.startsWith('TÍTULO')) currentTitulo = header;
      else if (header.startsWith('CAPÍTULO')) currentCapitulo = header;
      else if (header.startsWith('SEÇÃO')) currentSecao = header;
    }

    // Save the hierarchy context for this chunk's metadata
    const chunkLivro = currentLivro;
    const chunkTitulo = currentTitulo;
    const chunkCapitulo = currentCapitulo;
    const chunkSecao = currentSecao;

    // Extracts and preserves the exact formatting of the Article
    const matchArtigo = trimmed.match(/^Art(?:igo|\.)?\s*([\d\.\-\º°\^]+[A-Za-z]?)/i);
    let artigo = 'Geral/Introdução';

    if (matchArtigo) {
      const rawArtNumber = matchArtigo[1];
      artigo = `Art. ${rawArtNumber.replace(/[^\w\d\º°\-]/g, '')}`;
    }

    // Use the saved hierarchy context for this chunk's metadata
    const contextHeader = [chunkLivro, chunkTitulo, chunkCapitulo, chunkSecao]
      .filter(Boolean)
      .join(' > ');

    const metadata = {
      artigo,
      livro: chunkLivro || undefined,
      titulo: chunkTitulo || undefined,
      capitulo: chunkCapitulo || undefined,
      secao: chunkSecao || undefined,
      tipo_documento: tipoDocumento,
      esfera,
      fonte_pdf: fileName,
    };

    // 5. Safety Lock: If the article text exceeds MAX_CHUNK_LENGTH, apply the secondary split
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