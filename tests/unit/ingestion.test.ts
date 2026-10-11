import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { mockSetupQdrantCollection, mockQdrantUpsert, mockGenerateEmbedding, mockChunkLegislacao, mockPdfParse, mockUuid } = vi.hoisted(() => ({
  mockSetupQdrantCollection: vi.fn(),
  mockQdrantUpsert: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockChunkLegislacao: vi.fn(),
  mockPdfParse: vi.fn(),
  mockUuid: vi.fn(),
}));

vi.mock('../../src/config/qdrant.js', () => ({
  qdrantClient: {
    upsert: mockQdrantUpsert,
  },
  COLLECTION_NAME: 'legislacao_visa_test',
  setupQdrantCollection: mockSetupQdrantCollection,
}));

vi.mock('../../src/config/ollama.js', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../../src/utils/chunker.js', () => ({
  chunkLegislacao: mockChunkLegislacao,
}));

vi.mock('pdf-parse-new', () => ({
  default: mockPdfParse,
}));

vi.mock('uuid', () => ({
  v4: mockUuid,
}));

vi.mock('../../src/db/index.js', () => {
  const mockSelect = vi.fn().mockReturnThis();
  const mockFrom = vi.fn().mockReturnThis();
  const mockAll = vi.fn();
  const mockInsert = vi.fn().mockReturnThis();
  const mockValues = vi.fn().mockReturnThis();
  const mockRun = vi.fn();
  const mockWhere = vi.fn().mockReturnThis();
  const mockGet = vi.fn();
  const mockUpdate = vi.fn().mockReturnThis();
  const mockSet = vi.fn().mockReturnThis();
  const mockDelete = vi.fn().mockReturnThis();

  return {
    db: {
      select: mockSelect,
      from: mockFrom,
      all: mockAll,
      insert: mockInsert,
      values: mockValues,
      run: mockRun,
      where: mockWhere,
      get: mockGet,
      update: mockUpdate,
      set: mockSet,
      delete: mockDelete,
    },
  };
});

vi.mock('../../src/db/schema.js', () => ({
  documentsTable: {
    filename: 'filename',
    titulo: 'titulo',
    esfera: 'esfera',
    tipo: 'tipo',
    ano: 'ano',
    orgao: 'orgao',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

import { processPdfs } from '../../src/ingestion/ingest.js';
import { db } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

// The db module is replaced by a mock at the top of this file; this alias makes
// it explicit at compile time that the methods below are Vitest spies.
const dbMock = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('processPdfs (ingestion)', () => {
  const testPdfDir = path.join(os.tmpdir(), 'rag-visa-test-pdfs');
  const originalCwd = process.cwd();
  let createdTempDirs: string[] = [];

  beforeEach(() => {
    createdTempDirs = [];
    vi.clearAllMocks();
    
    mockSetupQdrantCollection.mockResolvedValue(undefined);
    mockQdrantUpsert.mockResolvedValue({});
    mockGenerateEmbedding.mockResolvedValue(Array(1024).fill(0.1));
    mockPdfParse.mockResolvedValue({ text: 'Conteúdo extraído do PDF.', numpages: 1 });
    mockChunkLegislacao.mockReturnValue([
      {
        content: 'Chunk 1',
        metadata: { artigo: 'Art. 1º', esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined },
      },
      {
        content: 'Chunk 2',
        metadata: { artigo: 'Art. 2º', esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined },
      },
    ]);
    mockUuid.mockReturnValue('test-uuid-123');
    
    dbMock.select.mockReturnThis();
    dbMock.from.mockReturnThis();
    dbMock.all.mockReturnValue([]);
    dbMock.insert.mockReturnThis();
    dbMock.values.mockReturnThis();
    dbMock.run.mockReturnThis();
    dbMock.where.mockReturnThis();
    dbMock.get.mockReturnThis();
  });

  afterEach(() => {
    vi.resetAllMocks();
    process.chdir(originalCwd);
    try { fs.rmSync(testPdfDir, { recursive: true, force: true }); } catch {}
    for (const dir of createdTempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  describe('setup', () => {
    it('should call setupQdrantCollection', async () => {
      dbMock.all.mockReturnValue([]);
      fs.mkdirSync(testPdfDir, { recursive: true });
      await processPdfs(testPdfDir);
      
      expect(mockSetupQdrantCollection).toHaveBeenCalled();
    });

    it('should create PDF directory if it does not exist', async () => {
      dbMock.all.mockReturnValue([]);
      const newDir = path.join(os.tmpdir(), 'new-pdf-dir-' + Date.now());
      createdTempDirs.push(newDir);
      await processPdfs(path.join(newDir, 'pdfs'));
      
      expect(fs.existsSync(path.join(newDir, 'pdfs'))).toBe(true);
    });
  });

  describe('no PDFs', () => {
    it('should return early when no PDFs found', async () => {
      dbMock.all.mockReturnValue([]);
      fs.mkdirSync(testPdfDir, { recursive: true });
      await processPdfs(testPdfDir);
      
      expect(mockPdfParse).not.toHaveBeenCalled();
      expect(mockChunkLegislacao).not.toHaveBeenCalled();
      expect(mockQdrantUpsert).not.toHaveBeenCalled();
    });
  });

  describe('with PDFs and metadata', () => {
    it('should process PDFs with metadata from database', async () => {
      const mockDbDocs = [
        { filename: 'doc1.pdf', titulo: 'Doc 1', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' },
        { filename: 'doc2.pdf', titulo: 'Doc 2', esfera: 'estadual', tipo: 'modelo_notificacao', ano: 2023, orgao: 'SES' },
      ];
      dbMock.all.mockReturnValue(mockDbDocs);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'doc1.pdf'), '%PDF-1.4 test');
      fs.writeFileSync(path.join(testPdfDir, 'doc2.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      expect(mockPdfParse).toHaveBeenCalledTimes(2);
      expect(mockChunkLegislacao).toHaveBeenCalledTimes(2);
      expect(mockQdrantUpsert).toHaveBeenCalled();
    });

    it('should use metadata from database for chunking', async () => {
      dbMock.all.mockReturnValue([
        { filename: 'test.pdf', titulo: 'Título do Banco', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' },
      ]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'test.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      expect(mockChunkLegislacao).toHaveBeenCalledWith(
        'Conteúdo extraído do PDF.',
        'test.pdf'
      );
    });
  });

  describe('without metadata (defaults)', () => {
    it('should apply default metadata when not in database', async () => {
      dbMock.all.mockReturnValue([]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'sem_metadados.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      expect(mockChunkLegislacao).toHaveBeenCalled();
    });

    it('should use municipal as default esfera', async () => {
      dbMock.all.mockReturnValue([]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'sem_meta.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      const upsertCalls = mockQdrantUpsert.mock.calls;
      expect(upsertCalls.length).toBeGreaterThan(0);
      
      const firstBatch = upsertCalls[0][1];
      expect(firstBatch.points).toBeDefined();
      // Without metadata in the database, the ingestion fallback is 'municipal'/'legislacao'
      expect(firstBatch.points.length).toBeGreaterThan(0);
      expect(firstBatch.points[0].payload.esfera).toBe('municipal');
      expect(firstBatch.points[0].payload.tipo_documento).toBe('legislacao');
    });
  });

  describe('embedding and point creation', () => {
    it('should generate embeddings for each chunk', async () => {
      dbMock.all.mockReturnValue([]);
      mockChunkLegislacao.mockReturnValue([
        { content: 'Chunk 1', metadata: { artigo: 'Art. 1º', esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined } },
        { content: 'Chunk 2', metadata: { artigo: 'Art. 2º', esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined } },
        { content: 'Chunk 3', metadata: { artigo: 'Art. 3º', esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined } },
      ]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'test.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(3);
    });

    it('should create points with correct structure', async () => {
      dbMock.all.mockReturnValue([]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'test.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      const upsertCalls = mockQdrantUpsert.mock.calls;
      expect(upsertCalls.length).toBeGreaterThan(0);
      
      const batch = upsertCalls[0][1];
      expect(batch.wait).toBe(true);
      expect(batch.points).toBeDefined();
      expect(batch.points[0]).toHaveProperty('id');
      expect(batch.points[0]).toHaveProperty('vector');
      expect(batch.points[0]).toHaveProperty('payload');
      expect(batch.points[0].payload).toHaveProperty('content');
      expect(batch.points[0].payload).toHaveProperty('artigo');
      expect(batch.points[0].payload).toHaveProperty('esfera');
      expect(batch.points[0].payload).toHaveProperty('fonte_pdf');
    });

    it('should include all metadata in payload', async () => {
      dbMock.all.mockReturnValue([
        { filename: 'completo.pdf', titulo: 'Doc Completo', esfera: 'estadual', tipo: 'modelo_notificacao', ano: 2022, orgao: 'SES-SP' },
      ]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'completo.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      const batch = mockQdrantUpsert.mock.calls[0][1];
      const payload = batch.points[0].payload;
      
      expect(payload.tipo_documento).toBe('modelo_notificacao');
      expect(payload.esfera).toBe('estadual');
      expect(payload.fonte_pdf).toBe('Doc Completo');
    });
  });

  describe('batch insertion', () => {
    it('should insert in batches of BATCH_SIZE', async () => {
      dbMock.all.mockReturnValue([]);
      const manyChunks = Array(30).fill(null).map((_, i) => ({
        content: `Chunk ${i}`,
        metadata: { artigo: `Art. ${i}º`, esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined },
      }));
      mockChunkLegislacao.mockReturnValue(manyChunks);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'test.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      expect(mockQdrantUpsert).toHaveBeenCalledTimes(2);
    });

    it('should use correct batch size', async () => {
      dbMock.all.mockReturnValue([]);
      const manyChunks = Array(50).fill(null).map((_, i) => ({
        content: `Chunk ${i}`,
        metadata: { artigo: `Art. ${i}º`, esfera: 'federal', tipo_documento: 'legislacao', fonte_pdf: 'test.pdf', livro: undefined, titulo: undefined, capitulo: undefined, secao: undefined },
      }));
      mockChunkLegislacao.mockReturnValue(manyChunks);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'test.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      const calls = mockQdrantUpsert.mock.calls;
      expect(calls[0][1].points).toHaveLength(25);
      expect(calls[1][1].points).toHaveLength(25);
    });
  });

  describe('error handling', () => {
    it('should propagate PDF read errors', async () => {
      dbMock.all.mockReturnValue([{ filename: 'erro.pdf', titulo: 'Erro', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' }]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'erro.pdf'), '%PDF-1.4 test');
      mockPdfParse.mockRejectedValue(new Error('PDF corrupt'));
      
      await expect(processPdfs(testPdfDir)).rejects.toThrow('PDF corrupt');
    });

    it('should propagate chunking errors', async () => {
      dbMock.all.mockReturnValue([{ filename: 'erro.pdf', titulo: 'Erro', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' }]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'erro.pdf'), '%PDF-1.4 test');
      mockChunkLegislacao.mockImplementation(() => { throw new Error('Chunking failed'); });
      
      await expect(processPdfs(testPdfDir)).rejects.toThrow('Chunking failed');
    });

    it('should propagate embedding errors', async () => {
      dbMock.all.mockReturnValue([{ filename: 'erro.pdf', titulo: 'Erro', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' }]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'erro.pdf'), '%PDF-1.4 test');
      mockGenerateEmbedding.mockRejectedValue(new Error('Ollama down'));
      
      await expect(processPdfs(testPdfDir)).rejects.toThrow('Ollama down');
    });

    it('should propagate Qdrant upsert errors', async () => {
      dbMock.all.mockReturnValue([{ filename: 'erro.pdf', titulo: 'Erro', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' }]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'erro.pdf'), '%PDF-1.4 test');
      mockQdrantUpsert.mockRejectedValue(new Error('Qdrant error'));
      
      await expect(processPdfs(testPdfDir)).rejects.toThrow('Qdrant error');
    });

    it('should not silently swallow errors', async () => {
      dbMock.all.mockReturnValue([{ filename: 'erro.pdf', titulo: 'Erro', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' }]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'erro.pdf'), '%PDF-1.4 test');
      mockQdrantUpsert.mockRejectedValue(new Error('Falha silenciosa'));
      
      let errorThrown = false;
      try {
        await processPdfs(testPdfDir);
      } catch (e) {
        errorThrown = true;
        expect((e as Error).message).toBe('Falha silenciosa');
      }
      
      expect(errorThrown).toBe(true);
    });
  });

  describe('summary report', () => {
    it('should process multiple files and track stats', async () => {
      dbMock.all.mockReturnValue([
        { filename: 'doc1.pdf', titulo: 'Doc 1', esfera: 'federal', tipo: 'legislacao', ano: 2024, orgao: 'ANVISA' },
        { filename: 'doc2.pdf', titulo: 'Doc 2', esfera: 'municipal', tipo: 'modelo_notificacao', ano: 2023, orgao: 'CVS' },
      ]);
      
      fs.mkdirSync(testPdfDir, { recursive: true });
      fs.writeFileSync(path.join(testPdfDir, 'doc1.pdf'), '%PDF-1.4 test');
      fs.writeFileSync(path.join(testPdfDir, 'doc2.pdf'), '%PDF-1.4 test');
      await processPdfs(testPdfDir);
      
      expect(mockChunkLegislacao).toHaveBeenCalledTimes(2);
      expect(mockQdrantUpsert).toHaveBeenCalled();
    });
  });
});