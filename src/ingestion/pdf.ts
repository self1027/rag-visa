import pdfParse from 'pdf-parse-new';
// Extract pages separately to retain exact page provenance, then chunk as one legal text.
export async function extractPdf(buffer: Buffer) {
  const pages: string[] = [];
  const parsed = await pdfParse(buffer, { pagerender: async (page: any) => {
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let text = ''; let y: number | undefined;
    for (const item of content.items) {
      const nextY = item.transform?.[5];
      if (y !== undefined && nextY !== y) text += '\n';
      text += `${item.str} `; y = nextY;
    }
    pages.push(text.trim());
    return text;
  } });
  if (!pages.length) return { text: parsed.text, pages: [] as string[] };
  return { text: pages.join('\n\n'), pages };
}

export function locatePages(content: string, pages: string[]) {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const normalized = pages.map(normalize);
  const text = normalized.join(' ');
  const body = normalize(content.replace(/^\[[^\n]*\]\n/, ''));
  const start = text.indexOf(body.slice(0, 120));
  if (start < 0) return {};
  const tail = text.indexOf(body.slice(-120), start);
  const end = tail >= 0 ? tail + Math.min(body.length, 120) - 1 : start;
  const pageAt = (offset: number) => {
    let cursor = 0;
    for (let index = 0; index < normalized.length; index++) {
      cursor += normalized[index].length + 1;
      if (offset < cursor) return index + 1;
    }
    return normalized.length;
  };
  return { pagina: pageAt(start), paginaFim: pageAt(end) };
}
