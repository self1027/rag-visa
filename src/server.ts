import { settings } from './config/settings.js';
import { adminAuth } from './middleware/adminAuth.js';
import { observe, metrics } from './observability/index.js';
import { loadConversation, saveConversation, refreshEvidence } from './rag/conversations.js';
import 'dotenv/config';
import express, { Request, Response, NextFunction, Express } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { migrateDatabase } from './db/migrate.js';
import { documentIngestionsTable } from './db/schema.js';
import { createIngestionService, listIngestionStates, pendingIngestion, type IngestionService } from './ingestion/service.js';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { documentsTable } from './db/schema.js';
import { askRAG, ChatMessage } from './rag/generator.js';
import { chatLimiter } from './middleware/rateLimiter.js';
import { enforceTokenLimit } from './middleware/tokenLimiter.js';

export const PDF_DIR = path.resolve(process.env.PDF_DIR || path.join('data', 'pdfs'));
const PORT = settings.port;

export function createApp(customDb?: typeof db, customPdfDir?: string, customChatLimiter?: express.RequestHandler, customIngestion?: IngestionService): Express {
  const app = express();
  app.use(observe);
  app.set('trust proxy', settings.trustProxyHops);
  const pdfDir = customPdfDir || PDF_DIR;
  const database = customDb || db;
  const rateLimiter = customChatLimiter || chatLimiter;

  migrateDatabase(database);
  const ingestion = customIngestion || createIngestionService(database, pdfDir);
  if (!customIngestion) ingestion.resume();
  const ingestionState = (filename: string) => listIngestionStates(database).get(filename) || { ...pendingIngestion };
  const discardUpload = (req: Request) => {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  };
  const validPdf = (req: Request) => {
    if (!req.file) return true;
    const descriptor = fs.openSync(req.file.path, 'r');
    try {
      const signature = Buffer.alloc(5);
      fs.readSync(descriptor, signature, 0, 5, 0);
      return signature.toString('ascii') === '%PDF-' && path.extname(req.file.originalname).toLowerCase() === '.pdf';
    } finally { fs.closeSync(descriptor); }
  };
  const validMetadata = (metadata: { titulo: unknown; esfera: unknown; tipo: unknown; ano: unknown; orgao: unknown }) =>
    typeof metadata.titulo === 'string' && metadata.titulo.trim().length > 0 && metadata.titulo.length <= 500 &&
    typeof metadata.orgao === 'string' && metadata.orgao.trim().length > 0 && metadata.orgao.length <= 200 &&
    ['federal', 'estadual', 'municipal'].includes(String(metadata.esfera)) &&
    typeof metadata.tipo === 'string' && metadata.tipo.trim().length > 0 && metadata.tipo.length <= 100 &&
    Number.isInteger(Number(metadata.ano)) && Number(metadata.ano) >= 1 && Number(metadata.ano) <= 9999;

  const provenance = (body: Record<string, unknown>, existing?: { jurisdicao?: string | null; urlOficial?: string | null; vigencia?: string; versao?: string | null }) => {
    const result = {
      jurisdicao: body.jurisdicao === undefined ? existing?.jurisdicao ?? null : String(body.jurisdicao).trim() || null,
      urlOficial: body.urlOficial === undefined ? existing?.urlOficial ?? null : String(body.urlOficial).trim() || null,
      vigencia: body.vigencia === undefined ? existing?.vigencia ?? 'desconhecida' : String(body.vigencia),
      versao: body.versao === undefined ? existing?.versao ?? null : String(body.versao).trim() || null,
    };
    if (!['vigente', 'revogada', 'desconhecida'].includes(result.vigencia) ||
        (result.jurisdicao?.length || 0) > 120 || (result.versao?.length || 0) > 120 ||
        (result.urlOficial && !/^https?:\/\//i.test(result.urlOficial))) throw Object.assign(new Error('Metadados de origem inválidos.'), { status: 400 });
    return result;
  };

  const upload = multer({
    limits: { fileSize: settings.uploadMaxBytes, files: 1, fields: 9, fieldSize: 2048 },
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const tempDir = path.join(pdfDir, '.uploads');
        fs.mkdirSync(tempDir, { recursive: true });
        cb(null, tempDir);
      },
      filename: (req, file, cb) => {
        cb(null, `${randomUUID()}.tmp`);
      }
    }),
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        // Client-side validation error: handled by the error middleware
        // (registered after the routes) and converted into a 400 JSON response.
        const invalidType: any = new Error('Apenas arquivos PDF são permitidos.');
        invalidType.status = 400;
        cb(invalidType);
      }
    }
  });

  app.use(cors({
    origin: settings.corsOrigins.length ? (origin, callback) => callback(null, !origin || settings.corsOrigins.includes(origin)) : '*',
    exposedHeaders: ['X-Request-Id', 'X-Conversation-Id'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  app.use(express.json());

  interface ChatRequestBody {
    history: ChatMessage[];
    conversationId?: string;
    jurisdicao?: string;
    esfera?: 'federal' | 'estadual' | 'municipal';
    preferMunicipal?: boolean;
  }

  app.get('/api/documents', (req: Request, res: Response) => {
    try {
      const documents = database.select().from(documentsTable).all();

      const states = listIngestionStates(database);
      return res.json({
        total: documents.length,
        documents: documents.map(document => ({ ...document, ingestion: states.get(document.filename) || { ...pendingIngestion } }))
      });
    } catch (error: any) {
      console.error('Erro ao ler os documentos do banco:', error);
      return res.status(500).json({ error: 'Erro interno ao carregar os documentos.' });
    }
  });

  app.get('/api/documents/:filename', (req: Request, res: Response) => {
    const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const filename = path.basename(rawFilename);
    const filePath = path.join(pdfDir, filename);

    if (path.extname(filename).toLowerCase() !== '.pdf' || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'Arquivo PDF não encontrado.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.sendFile(filePath, error => {
      if (error && !res.headersSent) res.status(404).json({ error: 'Arquivo PDF não encontrado.' });
      else if (error) res.destroy();
    });
  });

  app.post('/api/documents', adminAuth, upload.single('file'), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'O arquivo PDF é obrigatório.' });
      }

      const filename = path.basename(req.file.originalname);
      const { titulo, esfera, tipo, ano, orgao } = req.body;

      if (!titulo || !esfera || !tipo || !ano || !orgao) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Todos os metadados (titulo, esfera, tipo, ano, orgao) são obrigatórios.' });
      }

      if (!validMetadata({ titulo, esfera, tipo, ano, orgao }) || !validPdf(req)) {
        discardUpload(req);
        return res.status(400).json({ error: 'Metadados inválidos ou arquivo PDF inválido.' });
      }
      const sourceMetadata = provenance(req.body);
      const existing = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
      if (existing || fs.existsSync(path.join(pdfDir, filename))) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(409).json({ error: 'Já existe um documento com este nome no banco de dados.' });
      }

      const target = path.join(pdfDir, filename);
      // Exclusive link prevents concurrent uploads from replacing existing PDFs.
      fs.linkSync(req.file.path, target);
      try {
        database.transaction(tx => {
          tx.insert(documentsTable).values({ filename, titulo, esfera, tipo, ano: Number(ano), orgao, ...sourceMetadata }).run();
          ingestion.enqueue(filename);
        });
      } catch (error) {
        fs.unlinkSync(target);
        throw error;
      }
      discardUpload(req);

      const created = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();

      return res.status(201).json({
        message: 'Documento adicionado com sucesso.',
        filename,
        metadata: { ...created, ingestion: ingestionState(filename) }
      });
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      if (error.status === 400) return res.status(400).json({ error: error.message });
      console.error('Erro ao criar documento:', error);
      return res.status(500).json({ error: 'Erro interno ao salvar o documento.' });
    }
  });

  app.put('/api/documents/:filename', adminAuth, upload.single('file'), (req: Request, res: Response) => {
    try {
      const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
      const filename = path.basename(rawFilename);
      
      const existing = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
      if (!existing) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Documento não encontrado no banco de dados.' });
      }

      if (ingestion.isBusy(filename)) {
        discardUpload(req);
        return res.status(409).json({ error: 'Aguarde a ingestão terminar antes de alterar o documento.' });
      }
      const { titulo, esfera, tipo, ano, orgao } = req.body;

      const updatedData = {
        ...provenance(req.body, existing),
        titulo: titulo ?? existing.titulo,
        esfera: esfera ?? existing.esfera,
        tipo: tipo ?? existing.tipo,
        ano: ano !== undefined ? Number(ano) : existing.ano,
        orgao: orgao ?? existing.orgao
      };

      if (!validMetadata(updatedData) || !validPdf(req)) {
        discardUpload(req);
        return res.status(400).json({ error: 'Metadados inválidos ou arquivo PDF inválido.' });
      }
      const targetPdfPath = path.join(pdfDir, filename);
      const backupPath = path.join(pdfDir, '.uploads', `${randomUUID()}.backup`);
      let backedUp = false;
      try {
        if (req.file) {
          if (fs.existsSync(targetPdfPath)) {
            fs.renameSync(targetPdfPath, backupPath);
            backedUp = true;
          }
          fs.renameSync(req.file.path, targetPdfPath);
        }
        database.transaction(tx => {
          tx.update(documentsTable).set(updatedData)
            .where(eq(documentsTable.filename, filename)).run();
          ingestion.enqueue(filename, existing.titulo);
        });
      } catch (error) {
        if (req.file && fs.existsSync(targetPdfPath)) fs.unlinkSync(targetPdfPath);
        if (backedUp) fs.renameSync(backupPath, targetPdfPath);
        throw error;
      }
      if (backedUp) fs.unlinkSync(backupPath);

      const updated = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();

      return res.json({
        message: 'Documento atualizado com sucesso.',
        filename,
        metadata: { ...updated, ingestion: ingestionState(filename) }
      });
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      if (error.status === 400) return res.status(400).json({ error: error.message });
      console.error('Erro ao atualizar documento:', error);
      return res.status(500).json({ error: 'Erro interno ao atualizar o documento.' });
    }
  });

  app.delete('/api/documents/:filename', adminAuth, async (req: Request, res: Response) => {
    try {
      const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
      const filename = path.basename(rawFilename);

      const existing = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
      if (!existing) {
        return res.status(404).json({ error: 'Documento não encontrado no banco de dados.' });
      }

      if (ingestion.isBusy(filename)) {
        return res.status(409).json({ error: 'Aguarde a ingestão terminar antes de excluir o documento.' });
      }
      const filePath = path.join(pdfDir, filename);
      const tempDir = path.join(pdfDir, '.uploads');
      fs.mkdirSync(tempDir, { recursive: true });
      const backupPath = path.join(tempDir, `${filename}.deleted`);
      const hasFile = fs.existsSync(filePath);
      if (hasFile) fs.renameSync(filePath, backupPath);
      try {
        await ingestion.remove(existing);
        database.transaction(tx => {
          tx.delete(documentIngestionsTable).where(eq(documentIngestionsTable.filename, filename)).run();
          tx.delete(documentsTable).where(eq(documentsTable.filename, filename)).run();
        });
      } catch (error) {
        if (hasFile) fs.renameSync(backupPath, filePath);
        throw error;
      }
      if (hasFile) {
        try { fs.unlinkSync(backupPath); }
        catch (error) { console.error('Falha ao remover backup do PDF excluído:', error); }
      }

      return res.json({ message: `Documento ${filename} excluído com sucesso.` });
    } catch (error: any) {
      console.error('Erro ao excluir documento:', error);
      return res.status(500).json({ error: 'Erro interno ao excluir o documento.' });
    }
  });

  app.post('/api/documents/:filename/ingest', adminAuth, (req: Request, res: Response) => {
    const filename = path.basename(String(req.params.filename));
    const document = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
    if (!document) return res.status(404).json({ error: 'Documento não encontrado no banco de dados.' });
    if (ingestion.isBusy(filename)) return res.status(409).json({ error: 'O documento já está na fila de ingestão.' });
    ingestion.enqueue(filename);
    return res.status(202).json({ filename, ingestion: ingestionState(filename) });
  });

  app.post('/api/chat', rateLimiter, async (req: Request<{}, {}, ChatRequestBody>, res: Response) => {
    const { history } = req.body || {};

    if (!history || !Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: 'O histórico de mensagens é obrigatório.' });
    }

    if (history.some(message => !message || !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim()) || history.at(-1)?.role !== 'user') {
      return res.status(400).json({ error: 'Mensagens inválidas. A última mensagem deve ser do usuário.' });
    }
    const sanitizedHistory = enforceTokenLimit(history, settings.maxHistoryTokens);
    if (!sanitizedHistory.length) return res.status(400).json({ error: 'A mensagem excede o limite de tokens.' });

    if (req.body.conversationId !== undefined && (typeof req.body.conversationId !== 'string' || !/^[a-f0-9-]{36}$/.test(req.body.conversationId))) {
      return res.status(400).json({ error: 'Identificador de conversa inválido.' });
    }
    if (req.body.jurisdicao !== undefined && (typeof req.body.jurisdicao !== 'string' || req.body.jurisdicao.length > 120)) {
      return res.status(400).json({ error: 'Jurisdição inválida.' });
    }
    if ((req.body.esfera !== undefined && !['federal', 'estadual', 'municipal'].includes(req.body.esfera)) ||
        (req.body.preferMunicipal !== undefined && typeof req.body.preferMunicipal !== 'boolean')) return res.status(400).json({ error: 'Filtros inválidos.' });
    const conversation = loadConversation(database, req.body.conversationId);
    if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada ou expirada.' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Tempo limite da resposta excedido.')), settings.chatTimeoutMs);
    const abort = () => { if (!res.writableEnded) controller.abort(new Error('Cliente desconectado.')); };
    res.once('close', abort);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Conversation-Id', conversation.id);
    try {
      const evidence = await refreshEvidence(conversation.evidence);
      const result = await askRAG(sanitizedHistory, chunk => {
        controller.signal.throwIfAborted();
        if (!res.destroyed) res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      }, { evidence, signal: controller.signal, search: { jurisdicao: req.body.jurisdicao, esfera: req.body.esfera, preferMunicipal: req.body.preferMunicipal } });
      controller.signal.throwIfAborted();
      saveConversation(database, conversation.id, result.evidence || evidence);
      res.write(`data: ${JSON.stringify({ type: 'sources', sources: result.sources, normalizedQuery: result.normalizedQuery, conversationId: conversation.id })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: controller.signal.aborted ? 'Resposta interrompida ou tempo limite excedido.' : 'Erro ao gerar a resposta. Tente novamente.' })}\n\n`);
        res.end();
      }
    } finally {
      clearTimeout(timer); res.off('close', abort);
    }
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/metrics', adminAuth, (_req, res) => {
    const states = [...listIngestionStates(database).values()];
    res.json({ http: metrics(), ingestion: {
      queued: states.filter(state => state.status === 'queued').length,
      processing: states.filter(state => state.status === 'processing').length,
      failed: states.filter(state => state.status === 'failed').length,
      completed: states.filter(state => state.status === 'completed').length,
    } });
  });
  app.get('/api/ready', async (_req, res) => {
    const checks = await Promise.allSettled([
      fetch(`${settings.qdrantUrl}/healthz`, { signal: AbortSignal.timeout(3000) }).then(response => { if (!response.ok) throw new Error(); }),
      fetch(`${settings.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) }).then(async response => {
        if (!response.ok) throw new Error();
        const tags = await response.json() as { models: Array<{ name: string }> };
        if (!tags.models.some(model => model.name.split(':')[0] === settings.embeddingModel.split(':')[0])) throw new Error();
      }),
    ]);
    const ready = checks.every(check => check.status === 'fulfilled');
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable',
      qdrant: checks[0].status === 'fulfilled', ollama: checks[1].status === 'fulfilled' });
  });

  // Error handling middleware (registered after the routes).
  // Converts Multer upload errors into 400 JSON responses and any other
  // unhandled errors into 500 JSON, keeping the API error contract.
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    if (err instanceof multer.MulterError || err?.status === 400) {
      return res.status(400).json({ error: err.message });
    }

    console.error('Erro não tratado na API:', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  return app;
}

// Only start the server if this file is run directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando com SQLite/Drizzle na porta ${PORT}`);
  });
}
