import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../../src/server.js';
import { createTestDb, seedTestDb } from '../setup.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { documentsTable, documentIngestionsTable } from '../../src/db/schema.js';
import type { IngestionService } from '../../src/ingestion/service.js';
import { eq } from 'drizzle-orm';
import { estimateTokens } from '../../src/middleware/tokenLimiter.js';

// Mock askRAG at the top level with vi.hoisted
const { mockAskRAG } = vi.hoisted(() => ({
  mockAskRAG: vi.fn(),
}));

vi.mock('../../src/rag/generator.js', () => ({
  askRAG: mockAskRAG,
  ChatMessage: {},
}));

describe('HTTP API Integration Tests', () => {
  let app: express.Express;
  let testDb: ReturnType<typeof createTestDb>;
  let tempPdfDir: string;
  let ingestion: IngestionService;

  beforeEach(() => {
    testDb = createTestDb();
    seedTestDb(testDb.db);
    
    // Create temporary PDF directory
    tempPdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-visa-pdfs-'));
    
    // Create app WITHOUT rate limiter for testing
    const noOpRateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => next();
    ingestion = {
      enqueue: vi.fn(filename => {
        testDb.db.insert(documentIngestionsTable).values({ filename, status: 'completed', phase: 'completed', progress: 100, updatedAt: new Date().toISOString() })
          .onConflictDoUpdate({ target: documentIngestionsTable.filename, set: { status: 'completed', progress: 100 } }).run();
      }),
      isBusy: vi.fn(() => false), remove: vi.fn().mockResolvedValue(undefined), resume: vi.fn(),
    };
    app = createApp(testDb.db, tempPdfDir, noOpRateLimiter, ingestion);
    
    // Reset mock
    mockAskRAG.mockReset();
    mockAskRAG.mockResolvedValue({
      answer: 'Resposta de teste',
      normalizedQuery: 'query normalizada',
      sources: [{ artigo: 'Art. 1º', score: 0.9, fonte: 'doc.pdf' }],
    });
  });

  afterEach(() => {
    testDb.sqlite.close();
    try { fs.rmSync(tempPdfDir, { recursive: true, force: true }); } catch {}
  });

  // Simulate a query failure on the real database without closing the handle: the
  // db `select` method is replaced by one that throws immediately, and each
  // route catches the exception in its own catch, returning 500. This avoids
  // the double SQLite close (test + afterEach).
  function injectDbQueryError() {
    testDb.db.select = () => {
      throw new Error('Falha simulada no banco de dados');
    };
  }

  describe('GET /api/documents', () => {
    it('should return empty list when no documents', async () => {
      const emptyDb = createTestDb();
      const emptyApp = createApp(emptyDb.db, tempPdfDir, (req, res, next) => next(), ingestion);
      
      const res = await request(emptyApp).get('/api/documents');
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 0, documents: [] });
      
      emptyDb.sqlite.close();
    });

    it('should return list with documents', async () => {
      const res = await request(app).get('/api/documents');
      
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.documents).toHaveLength(3);
      expect(res.body.documents[0]).toHaveProperty('filename');
      expect(res.body.documents[0]).toHaveProperty('titulo');
      expect(res.body.documents[0]).toHaveProperty('esfera');
      expect(res.body.documents[0]).toHaveProperty('tipo');
      expect(res.body.documents[0]).toHaveProperty('ano');
      expect(res.body.documents[0]).toHaveProperty('orgao');
    });

    it('should return correct structure', async () => {
      const res = await request(app).get('/api/documents');
      
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('documents');
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      // Simulate a query error without closing the database handle
      injectDbQueryError();
      
      const res = await request(app).get('/api/documents');
      
      // Exact route message: distinguishes the route's own catch from the
      // error middleware's generic fallback ('Erro interno do servidor.')
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Erro interno ao carregar os documentos.');
    });
  });

  describe('GET /api/documents/:filename', () => {
    it('should return 404 for non-existent file', async () => {
      const res = await request(app).get('/api/documents/inexistente.pdf');
      
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('não encontrado');
    });

    it('should normalize filename with path.basename', async () => {
      // Create a dummy PDF file
      const pdfPath = path.join(tempPdfDir, 'test.pdf');
      fs.writeFileSync(pdfPath, '%PDF-1.4 test content');
      
      const res = await request(app).get('/api/documents/test.pdf');
      
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it('should prevent path traversal', async () => {
      // "Secret" file outside tempPdfDir, in the same parent directory
      const secretPath = path.join(tempPdfDir, '..', 'traversal-secret.txt');
      fs.writeFileSync(secretPath, 'SECRET-CONTENT-XYZ');
      
      try {
        // %2e%2e%2f = encoded "../": reaches Express without normalization and the
        // :filename param becomes '../traversal-secret.txt' after decode. A single
        // '..' suffices because the secret is one level above tempPdfDir.
        const res = await request(app)
          .get('/api/documents/..%2Ftraversal-secret.txt');
        
        // path.basename reduces it to 'traversal-secret.txt', which does not exist
        // inside tempPdfDir -> 404, without leaking the parent file's content.
        // The route's JSON body (not Express's 404 HTML) proves the route
        // executed with the decoded payload.
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('não encontrado');
        expect(res.text).not.toContain('SECRET-CONTENT-XYZ');
      } finally {
        fs.rmSync(secretPath, { force: true });
      }
    });

    it('should not serve files from outside the pdf directory', async () => {
      // Real file in the PARENT directory of tempPdfDir (outside the served root)
      const outsidePath = path.join(tempPdfDir, '..', 'outside.pdf');
      fs.writeFileSync(outsidePath, '%PDF-1.4 outside');
      
      try {
        const res = await request(app)
          .get('/api/documents/outside.pdf');
        
        // basename('outside.pdf') -> looks inside tempPdfDir, where it does not exist
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('outside');
      } finally {
        fs.rmSync(outsidePath, { force: true });
      }
    });

    it('should set correct headers', async () => {
      const pdfPath = path.join(tempPdfDir, 'test.pdf');
      fs.writeFileSync(pdfPath, '%PDF-1.4 test content');
      
      const res = await request(app).get('/api/documents/test.pdf');
      
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('inline');
      expect(res.headers['content-disposition']).toContain('test.pdf');
    });

    it('should stream file content', async () => {
      const pdfContent = '%PDF-1.4\n%Test PDF content\n%%EOF';
      const pdfPath = path.join(tempPdfDir, 'stream-test.pdf');
      fs.writeFileSync(pdfPath, pdfContent);
      
      const res = await request(app).get('/api/documents/stream-test.pdf');
      
      expect(res.status).toBe(200);
      // application/pdf is a binary type: superagent fills res.body with a
      // Buffer and leaves res.text undefined.
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.toString('utf8')).toContain('PDF');
    });
  });

  describe('POST /api/documents', () => {
    const validPdfBuffer = Buffer.from('%PDF-1.4\n%Valid PDF\n%%EOF');
    const validMetadata = {
      titulo: 'Documento de Teste',
      esfera: 'federal',
      tipo: 'legislacao',
      ano: '2024',
      orgao: 'ANVISA',
    };

    it('should upload valid PDF with all metadata', async () => {
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'novo_documento.pdf')
        .field(validMetadata);
      
      expect(res.status).toBe(201);
      expect(res.body.message).toContain('sucesso');
      expect(res.body.filename).toBe('novo_documento.pdf');
      // All metadata persisted and returned, with numeric year
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.titulo).toBe('Documento de Teste');
      expect(res.body.metadata.esfera).toBe('federal');
      expect(res.body.metadata.tipo).toBe('legislacao');
      expect(res.body.metadata.ano).toBe(2024);
      expect(typeof res.body.metadata.ano).toBe('number');
      expect(res.body.metadata.orgao).toBe('ANVISA');
      // The file was actually written to the PDF directory
      const storedPath = path.join(tempPdfDir, 'novo_documento.pdf');
      expect(fs.existsSync(storedPath)).toBe(true);
      expect(fs.readFileSync(storedPath, 'utf8')).toContain('%PDF-1.4');
    });

    it('should return 400 when file is missing', async () => {
      const res = await request(app)
        .post('/api/documents')
        .field(validMetadata);
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('obrigatório');
    });

    it('should return 400 for non-PDF file', async () => {
      const txtBuffer = Buffer.from('not a pdf');
      
      const res = await request(app)
        .post('/api/documents')
        .attach('file', txtBuffer, 'documento.txt')
        .field(validMetadata);
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('PDF');
    });

    it('should return 400 when titulo is missing', async () => {
      const { titulo, ...metadata } = validMetadata;
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'test.pdf')
        .field(metadata);
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('obrigatórios');
    });

    it('should return 400 when esfera is missing', async () => {
      const { esfera, ...metadata } = validMetadata;
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'test.pdf')
        .field(metadata);
      
      expect(res.status).toBe(400);
    });

    it('should return 400 when tipo is missing', async () => {
      const { tipo, ...metadata } = validMetadata;
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'test.pdf')
        .field(metadata);
      
      expect(res.status).toBe(400);
    });

    it('should return 400 when ano is missing', async () => {
      const { ano, ...metadata } = validMetadata;
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'test.pdf')
        .field(metadata);
      
      expect(res.status).toBe(400);
    });

    it('should return 400 when orgao is missing', async () => {
      const { orgao, ...metadata } = validMetadata;
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'test.pdf')
        .field(metadata);
      
      expect(res.status).toBe(400);
    });

    it('should return 409 for duplicate filename', async () => {
      // First upload
      await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'duplicado.pdf')
        .field(validMetadata);
      
      // Second upload with same filename
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'duplicado.pdf')
        .field(validMetadata);
      
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Já existe');
      expect(fs.readFileSync(path.join(tempPdfDir, 'duplicado.pdf'))).toEqual(validPdfBuffer);
    });

    it('should convert ano to number', async () => {
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'ano_test.pdf')
        .field({ ...validMetadata, ano: '2023' });
      
      expect(res.status).toBe(201);
      expect(typeof res.body.metadata.ano).toBe('number');
      expect(res.body.metadata.ano).toBe(2023);
    });

    it('should persist metadata in database', async () => {
      await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'persist_test.pdf')
        .field(validMetadata);
      
      const docs = testDb.db.select().from(documentsTable).all();
      
      const created = docs.find(d => d.filename === 'persist_test.pdf');
      expect(created).toBeDefined();
      expect(created?.titulo).toBe('Documento de Teste');
    });

    it('should remove temp file on validation failure', async () => {
      const { titulo, ...metadata } = validMetadata;
      
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'fail_test.pdf')
        .field(metadata);
      
      expect(res.status).toBe(400);
      // Check no leftover files in temp upload directory
      const files = fs.readdirSync(tempPdfDir);
      const tempFiles = files.filter(f => f.startsWith('fail_test'));
      // The file should be cleaned up
      expect(tempFiles).toEqual([]);
    });

    it('should remove temp file on database error', async () => {
      // Simulate a query error: the route must respond 500 and remove the file
      // that multer had already written to tempPdfDir.
      injectDbQueryError();
      
      const res = await request(app)
        .post('/api/documents')
        .attach('file', validPdfBuffer, 'error_test.pdf')
        .field(validMetadata);
      
      // Exact route message (not the generic middleware's)
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Erro interno ao salvar o documento.');
      expect(fs.existsSync(path.join(tempPdfDir, 'error_test.pdf'))).toBe(false);
    });
  });

  describe('PUT /api/documents/:filename', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n%Test\n%%EOF');

    beforeEach(async () => {
      // Create a document to update
      await request(app)
        .post('/api/documents')
        .attach('file', pdfBuffer, 'atualizar.pdf')
        .field({
          titulo: 'Título Original',
          esfera: 'federal',
          tipo: 'legislacao',
          ano: '2020',
          orgao: 'ANVISA',
        });
    });

    it('should update existing document metadata', async () => {
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .field({ titulo: 'Título Atualizado' });
      
      expect(res.status).toBe(200);
      expect(res.body.metadata.titulo).toBe('Título Atualizado');
    });

    it('should preserve omitted fields', async () => {
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .field({ titulo: 'Novo Título' });
      
      expect(res.body.metadata.esfera).toBe('federal');
      expect(res.body.metadata.tipo).toBe('legislacao');
      expect(res.body.metadata.ano).toBe(2020);
      expect(res.body.metadata.orgao).toBe('ANVISA');
    });

    it('should return 404 for non-existent document', async () => {
      const res = await request(app)
        .put('/api/documents/inexistente.pdf')
        .field({ titulo: 'Novo' });
      
      expect(res.status).toBe(404);
    });

    it('should replace PDF file when provided', async () => {
      const newPdfBuffer = Buffer.from('%PDF-1.4\n%New PDF\n%%EOF');
      
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .attach('file', newPdfBuffer, 'atualizar.pdf')
        .field({ titulo: 'Com Novo PDF' });
      
      expect(res.status).toBe(200);
      // File should be replaced
      const filePath = path.join(tempPdfDir, 'atualizar.pdf');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should update without file', async () => {
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .field({ titulo: 'Sem PDF Novo' });
      
      expect(res.status).toBe(200);
      expect(res.body.metadata.titulo).toBe('Sem PDF Novo');
    });

    it('should convert ano to number', async () => {
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .field({ ano: '2025' });
      
      expect(res.body.metadata.ano).toBe(2025);
    });

    it('should remove temp file on failure', async () => {
      // Query error while looking up the existing document: the route responds 500
      // and removes the newly uploaded file.
      injectDbQueryError();
      
      const newPdfBuffer = Buffer.from('%PDF-1.4\n%New\n%%EOF');
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .attach('file', newPdfBuffer, 'atualizar.pdf')
        .field({ titulo: 'Falha' });
      
      // Exact PUT route message (not the generic middleware's)
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Erro interno ao atualizar o documento.');
      expect(fs.readFileSync(path.join(tempPdfDir, 'atualizar.pdf'))).toEqual(pdfBuffer);
      expect(fs.readdirSync(path.join(tempPdfDir, '.uploads'))).toEqual([]);
    });

    it('should return updated metadata', async () => {
      const res = await request(app)
        .put('/api/documents/atualizar.pdf')
        .field({ 
          titulo: 'Atualizado',
          esfera: 'estadual',
          tipo: 'modelo_notificacao',
          ano: '2021',
          orgao: 'SES-SP',
        });
      
      expect(res.body.metadata.titulo).toBe('Atualizado');
      expect(res.body.metadata.esfera).toBe('estadual');
      expect(res.body.metadata.tipo).toBe('modelo_notificacao');
      expect(res.body.metadata.ano).toBe(2021);
      expect(res.body.metadata.orgao).toBe('SES-SP');
    });
  });

  describe('DELETE /api/documents/:filename', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n%Test\n%%EOF');

    beforeEach(async () => {
      await request(app)
        .post('/api/documents')
        .attach('file', pdfBuffer, 'deletar.pdf')
        .field({
          titulo: 'Para Deletar',
          esfera: 'municipal',
          tipo: 'legislacao',
          ano: '2022',
          orgao: 'CVS',
        });
    });

    it('should delete existing document', async () => {
      const res = await request(app).delete('/api/documents/deletar.pdf');
      
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('excluído');
    });

    it('should remove record from database', async () => {
      await request(app).delete('/api/documents/deletar.pdf');
      
      const doc = testDb.db.select().from(documentsTable).where(eq(documentsTable.filename, 'deletar.pdf')).get();
      
      expect(doc).toBeUndefined();
    });

    it('should remove PDF file from disk', async () => {
      const filePath = path.join(tempPdfDir, 'deletar.pdf');
      expect(fs.existsSync(filePath)).toBe(true);
      
      await request(app).delete('/api/documents/deletar.pdf');
      
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should return 404 for non-existent document', async () => {
      const res = await request(app).delete('/api/documents/nao_existe.pdf');
      
      expect(res.status).toBe(404);
    });

    it('should handle database errors', async () => {
      // Erro de query simulado sem fechar o handle do banco
      injectDbQueryError();
      
      const res = await request(app).delete('/api/documents/deletar.pdf');
      
      // Exact DELETE route message (not the generic middleware's)
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Erro interno ao excluir o documento.');
      // The record must remain intact after the failure (queried via the raw
      // handle, since drizzle's select method is injected with the error)
      const doc = testDb.sqlite
        .prepare('SELECT filename FROM documents WHERE filename = ?')
        .get('deletar.pdf') as { filename: string } | undefined;
      expect(doc?.filename).toBe('deletar.pdf');
    });
  });

  describe('document safety regressions', () => {
    const metadata = { titulo: 'Teste', esfera: 'federal', tipo: 'legislacao', ano: '2024', orgao: 'ANVISA' };
    const original = Buffer.from('%PDF-1.4 original');
    it('rejects disguised PDFs and invalid metadata without saving files', async () => {
      const invalid = await request(app).post('/api/documents')
        .attach('file', Buffer.from('not a PDF'), { filename: 'fake.pdf', contentType: 'application/pdf' }).field(metadata);
      expect(invalid.status).toBe(400);
      expect(fs.existsSync(path.join(tempPdfDir, 'fake.pdf'))).toBe(false);
      const badYear = await request(app).post('/api/documents')
        .attach('file', original, 'invalid.pdf').field({ ...metadata, ano: 'abc' });
      expect(badYear.status).toBe(400);
      expect(fs.readdirSync(path.join(tempPdfDir, '.uploads'))).toEqual([]);
    });
    it('never overwrites another PDF when updating with its filename', async () => {
      await request(app).post('/api/documents').attach('file', original, 'first.pdf').field(metadata);
      await request(app).post('/api/documents').attach('file', original, 'second.pdf').field(metadata);
      const replacement = Buffer.from('%PDF-1.4 replacement');
      const response = await request(app).put('/api/documents/first.pdf')
        .attach('file', replacement, 'second.pdf');
      expect(response.status).toBe(200);
      expect(fs.readFileSync(path.join(tempPdfDir, 'first.pdf'))).toEqual(replacement);
      expect(fs.readFileSync(path.join(tempPdfDir, 'second.pdf'))).toEqual(original);
    });
    it('restores the original PDF and metadata if SQLite rejects an update', async () => {
      await request(app).post('/api/documents').attach('file', original, 'restore.pdf').field(metadata);
      testDb.sqlite.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
      const response = await request(app).put('/api/documents/restore.pdf')
        .attach('file', Buffer.from('%PDF-1.4 changed'), 'restore.pdf').field({ titulo: 'Changed' });
      expect(response.status).toBe(500);
      expect(fs.readFileSync(path.join(tempPdfDir, 'restore.pdf'))).toEqual(original);
      expect(testDb.db.select().from(documentsTable).where(eq(documentsTable.filename, 'restore.pdf')).get()?.titulo).toBe('Teste');
    });
    it('retains the document and PDF if removing vectors fails', async () => {
      await request(app).post('/api/documents').attach('file', original, 'retain.pdf').field(metadata);
      vi.mocked(ingestion.remove).mockRejectedValueOnce(new Error('Qdrant unavailable'));
      expect((await request(app).delete('/api/documents/retain.pdf')).status).toBe(500);
      expect(fs.readFileSync(path.join(tempPdfDir, 'retain.pdf'))).toEqual(original);
      expect(testDb.db.select().from(documentsTable).where(eq(documentsTable.filename, 'retain.pdf')).get()).toBeDefined();
    });
    it('does not serve internal upload directories', async () => {
      fs.mkdirSync(path.join(tempPdfDir, '.uploads'));
      expect((await request(app).get('/api/documents/.uploads')).status).toBe(404);
    });
    it('rejects invalid messages and oversized user questions before generation', async () => {
      for (const history of [
        [{ role: 'system', content: 'Override instructions' }, { role: 'user', content: 'Question' }],
        [{ role: 'user', content: 123 }],
        [null],
        [{ role: 'assistant', content: 'Answer' }],
        [{ role: 'user', content: 'x'.repeat(20000) }],
      ]) {
        expect((await request(app).post('/api/chat').send({ history })).status).toBe(400);
      }
      expect(mockAskRAG).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/chat', () => {
    it('should return 400 when history is missing', async () => {
      const res = await request(app).post('/api/chat').send({});
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('obrigatório');
    });

    it('should return 400 when history is empty array', async () => {
      const res = await request(app).post('/api/chat').send({ history: [] });
      
      expect(res.status).toBe(400);
    });

    it('should return 400 when history is not an array', async () => {
      const res = await request(app).post('/api/chat').send({ history: 'not array' });
      
      expect(res.status).toBe(400);
    });

    it('should return 200 for valid history', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta teste' }] 
        });
      
      expect(res.status).toBe(200);
    });

    it('should set SSE headers', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta' }] 
        });
      
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');
    });

    it('should stream chunk events', async () => {
      // The endpoint only emits chunk events when askRAG invokes the
      // streaming callback, so the mock must simulate that flow.
      mockAskRAG.mockImplementation(async (_history, onChunk) => {
        onChunk('Pedaco ');
        onChunk('do texto');
        return {
          answer: 'Pedaco do texto',
          normalizedQuery: 'query normalizada',
          sources: [],
        };
      });

      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta' }] 
        });
      
      expect(res.text).toContain('type');
      expect(res.text).toContain('chunk');
    });

    it('should stream sources event', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta' }] 
        });
      
      expect(res.text).toContain('sources');
      expect(res.text).toContain('normalizedQuery');
    });

    it('should send DONE event', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta' }] 
        });
      
      expect(res.text).toContain('[DONE]');
    });

    it('should include sources in response', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta' }] 
        });
      
      expect(res.text).toContain('Art. 1º');
      expect(res.text).toContain('doc.pdf');
    });

    it('should apply token limit to history', async () => {
      const longHistory = Array(21).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(1000),
      }));
      
      const res = await request(app)
        .post('/api/chat')
        .send({ history: longHistory });
      
      expect(res.status).toBe(200);

      // The mock receives history ALREADY truncated by enforceTokenLimit (5000 tokens)
      const received: Array<{ role: string; content: string }> = mockAskRAG.mock.calls[0][0];
      expect(received.length).toBeLessThan(21);

      // Token sum using the same formula as the middleware (+5 per message)
      const totalTokens = received.reduce((sum, msg) => sum + estimateTokens(msg.content) + 5, 0);
      expect(totalTokens).toBeLessThanOrEqual(5000);

      // The cut is FIFO: discards from the start, preserving the last message
      expect(received[received.length - 1]).toEqual(longHistory[longHistory.length - 1]);
    });

    it('should handle generation error', async () => {
      mockAskRAG.mockRejectedValueOnce(new Error('Generation failed'));
      
      const res = await request(app)
        .post('/api/chat')
        .send({ 
          history: [{ role: 'user', content: 'Pergunta' }] 
        });
      
      expect(res.text).toContain('error');
    });
  });
});