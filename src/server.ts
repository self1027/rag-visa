import 'dotenv/config';
import express, { Request, Response, NextFunction, Express } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { documentsTable } from './db/schema.js';
import { askRAG, ChatMessage } from './rag/generator.js';
import { chatLimiter } from './middleware/rateLimiter.js';
import { enforceTokenLimit } from './middleware/tokenLimiter.js';

export const PDF_DIR = path.join(process.cwd(), 'data', 'pdfs');
const PORT = Number(process.env.PORT) || 3333;

export function createApp(customDb?: typeof db, customPdfDir?: string, customChatLimiter?: express.RequestHandler): Express {
  const app = express();
  const pdfDir = customPdfDir || PDF_DIR;
  const database = customDb || db;
  const rateLimiter = customChatLimiter || chatLimiter;

  database.run(`
    CREATE TABLE IF NOT EXISTS documents (
      filename TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      esfera TEXT NOT NULL,
      tipo TEXT NOT NULL,
      ano INTEGER NOT NULL,
      orgao TEXT NOT NULL
    )
  `);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        if (!fs.existsSync(pdfDir)) {
          fs.mkdirSync(pdfDir, { recursive: true });
        }
        cb(null, pdfDir);
      },
      filename: (req, file, cb) => {
        const safeName = path.basename(file.originalname);
        cb(null, safeName);
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
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  app.use(express.json());

  interface ChatRequestBody {
    history: ChatMessage[];
  }

  app.get('/api/documents', (req: Request, res: Response) => {
    try {
      const documents = database.select().from(documentsTable).all();

      return res.json({
        total: documents.length,
        documents
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

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo PDF não encontrado.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  });

  app.post('/api/documents', upload.single('file'), (req: Request, res: Response) => {
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

      const existing = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
      if (existing) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(409).json({ error: 'Já existe um documento com este nome no banco de dados.' });
      }

      database.insert(documentsTable).values({
        filename,
        titulo,
        esfera,
        tipo,
        ano: Number(ano),
        orgao
      }).run();

      const created = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();

      return res.status(201).json({
        message: 'Documento adicionado com sucesso.',
        filename,
        metadata: created
      });
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error('Erro ao criar documento:', error);
      return res.status(500).json({ error: 'Erro interno ao salvar o documento.' });
    }
  });

  app.put('/api/documents/:filename', upload.single('file'), (req: Request, res: Response) => {
    try {
      const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
      const filename = path.basename(rawFilename);
      
      const existing = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
      if (!existing) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Documento não encontrado no banco de dados.' });
      }

      const { titulo, esfera, tipo, ano, orgao } = req.body;

      const updatedData = {
        titulo: titulo ?? existing.titulo,
        esfera: esfera ?? existing.esfera,
        tipo: tipo ?? existing.tipo,
        ano: ano ? Number(ano) : existing.ano,
        orgao: orgao ?? existing.orgao
      };

      database.update(documentsTable)
        .set(updatedData)
        .where(eq(documentsTable.filename, filename))
        .run();

      if (req.file) {
        const targetPdfPath = path.join(pdfDir, filename);
        if (path.resolve(req.file.path) !== path.resolve(targetPdfPath)) {
          if (fs.existsSync(targetPdfPath)) {
            fs.unlinkSync(targetPdfPath);
          }
          fs.renameSync(req.file.path, targetPdfPath);
        }
      }

      const updated = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();

      return res.json({
        message: 'Documento atualizado com sucesso.',
        filename,
        metadata: updated
      });
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error('Erro ao atualizar documento:', error);
      return res.status(500).json({ error: 'Erro interno ao atualizar o documento.' });
    }
  });

  app.delete('/api/documents/:filename', (req: Request, res: Response) => {
    try {
      const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
      const filename = path.basename(rawFilename);

      const existing = database.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get();
      if (!existing) {
        return res.status(404).json({ error: 'Documento não encontrado no banco de dados.' });
      }

      database.delete(documentsTable).where(eq(documentsTable.filename, filename)).run();

      const filePath = path.join(pdfDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      return res.json({ message: `Documento ${filename} excluído com sucesso.` });
    } catch (error: any) {
      console.error('Erro ao excluir documento:', error);
      return res.status(500).json({ error: 'Erro interno ao excluir o documento.' });
    }
  });

  app.post('/api/chat', rateLimiter, async (req: Request<{}, {}, ChatRequestBody>, res: Response) => {
    const { history } = req.body;

    if (!history || !Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: 'O histórico de mensagens é obrigatório.' });
    }

    const sanitizedHistory = enforceTokenLimit(history, 5000);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const result = await askRAG(sanitizedHistory, (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ type: 'sources', sources: result.sources, normalizedQuery: result.normalizedQuery })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      console.error('Erro na API de chat:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'Erro interno no servidor' })}\n\n`);
      res.end();
    }
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