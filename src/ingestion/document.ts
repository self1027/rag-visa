import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractPdf, locatePages } from './pdf.js';
import { settings } from '../config/settings.js';
import { qdrantClient, COLLECTION_NAME, setupQdrantCollection } from '../config/qdrant.js';
import { generateEmbedding } from '../config/ollama.js';
import { chunkLegislacao } from '../utils/chunker.js';
import { documentsTable } from '../db/schema.js';

type StoredDocument = typeof documentsTable.$inferSelect;
export type DocumentMetadata = Omit<StoredDocument, 'jurisdicao' | 'urlOficial' | 'vigencia' | 'versao'> & Partial<Pick<StoredDocument, 'jurisdicao' | 'urlOficial' | 'vigencia' | 'versao'>>;
export interface IngestionProgress {
  phase: 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'publishing';
  progress: number;
  totalChunks: number;
  embeddedChunks: number;
  indexedChunks: number;
}
export type ProgressCallback = (progress: IngestionProgress) => void;

// Compatibility with points ingested before filename was included in the payload.
export function documentFilter(document: DocumentMetadata, legacySource?: string | null) {
  return { should: [
    { key: 'filename', match: { value: document.filename } },
    { must: [
      { is_empty: { key: 'filename' } },
      { key: 'fonte_pdf', match: { any: [...new Set([document.titulo, legacySource, document.filename].filter((value): value is string => !!value))] } },
    ] },
  ] };
}

export async function removeDocumentVectors(document: DocumentMetadata, legacySource?: string | null) {
  const { exists } = await qdrantClient.collectionExists(COLLECTION_NAME);
  if (exists) {
    await qdrantClient.delete(COLLECTION_NAME, { wait: true, filter: documentFilter(document, legacySource) });
  }
}

// A UUID derived from document, content version and position makes retries idempotent.
function pointId(filename: string, version: string, index: number) {
  const hex = createHash('sha256').update(JSON.stringify([filename, version, index])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function ingestDocument(document: DocumentMetadata, pdfDir: string, onProgress: ProgressCallback, legacySource?: string | null) {
  const progress: IngestionProgress = {
    phase: 'extracting', progress: 2, totalChunks: 0, embeddedChunks: 0, indexedChunks: 0,
  };
  const report = (patch: Partial<IngestionProgress>) => {
    Object.assign(progress, patch);
    onProgress({ ...progress });
  };
  report({});
  await setupQdrantCollection();
  const buffer = await fs.readFile(path.join(pdfDir, document.filename));
  const parsed = await extractPdf(buffer);
  if (!parsed.text.trim()) throw new Error('O PDF não contém texto extraível. Faça OCR antes de enviá-lo.');
  report({ phase: 'chunking', progress: 5 });
  const chunks = chunkLegislacao(parsed.text, document.filename);
  if (!chunks.length) throw new Error('Nenhum trecho de texto foi extraído do PDF.');
  const version = createHash('sha256').update(buffer).update(JSON.stringify(document)).update(JSON.stringify(['chunker-v3', settings.embeddingModel, settings.embeddingDimensions, settings.embeddingContextTokens, settings.chunkMaxLength, settings.chunkOverlap])).digest('hex');
  const versionFilter = { must: [
    { key: 'filename', match: { value: document.filename } },
    { key: 'version', match: { value: version } },
  ] };
  const existing = await qdrantClient.count(COLLECTION_NAME, {
    exact: true, filter: { must: [...versionFilter.must, { key: 'indexed', match: { value: true } }] },
  });
  if (existing.count === chunks.length) {
    report({ phase: 'publishing', progress: 97, totalChunks: chunks.length,
      embeddedChunks: chunks.length, indexedChunks: chunks.length });
    await qdrantClient.delete(COLLECTION_NAME, { wait: true, filter: {
      must: [documentFilter(document, legacySource)], must_not: [{ key: 'version', match: { value: version } }],
    } });
    return;
  }
  // Remove abandoned staging points, but retain an already published identical version.
  await qdrantClient.delete(COLLECTION_NAME, {
    wait: true, filter: { must: [...versionFilter.must, { key: 'indexed', match: { value: false } }] },
  });
  let published = false;
  try {
    report({ phase: 'embedding', progress: 10, totalChunks: chunks.length });
    for (let offset = 0; offset < chunks.length; offset += settings.ingestionBatchSize) {
      const batch = [];
      for (let index = offset; index < Math.min(offset + settings.ingestionBatchSize, chunks.length); index++) {
        const chunk = chunks[index];
        const vector = await generateEmbedding(chunk.content);
        if (vector.length !== settings.embeddingDimensions || vector.some(value => !Number.isFinite(value))) {
          throw new Error('O modelo de embedding retornou um vetor inválido.');
        }
        batch.push({
          id: pointId(document.filename, version, index), vector,
          payload: {
            ...chunk.metadata, ...locatePages(chunk.content, parsed.pages), content: chunk.content, filename: document.filename,
            fonte_pdf: document.titulo, esfera: document.esfera, tipo_documento: document.tipo,
            ano: document.ano, orgao: document.orgao, jurisdicao: document.jurisdicao,
            url_oficial: document.urlOficial, vigencia: document.vigencia || 'desconhecida', versao: document.versao, version, indexed: false,
          },
        });
        report({ phase: 'embedding', embeddedChunks: index + 1,
          progress: 10 + Math.floor(70 * (index + 1) / chunks.length) + Math.floor(15 * progress.indexedChunks / chunks.length) });
      }
      report({ phase: 'indexing' });
      await qdrantClient.upsert(COLLECTION_NAME, { wait: true, points: batch });
      report({ indexedChunks: offset + batch.length,
        progress: 10 + Math.floor(70 * progress.embeddedChunks / chunks.length) + Math.floor(15 * (offset + batch.length) / chunks.length) });
    }
    report({ phase: 'publishing', progress: 97 });
    await qdrantClient.setPayload(COLLECTION_NAME, { wait: true, payload: { indexed: true }, filter: versionFilter });
    published = true;
    // The new version is searchable before retiring earlier versions.
    await qdrantClient.delete(COLLECTION_NAME, { wait: true, filter: {
      must: [documentFilter(document, legacySource)],
      must_not: [{ key: 'version', match: { value: version } }],
    } });
  } catch (error) {
    if (!published) {
      try {
        await qdrantClient.delete(COLLECTION_NAME, {
          wait: true, filter: { must: [...versionFilter.must, { key: 'indexed', match: { value: false } }] },
        });
      } catch (cleanupError) { console.error('Falha ao limpar vetores temporários:', cleanupError); }
    }
    throw error;
  }
}
