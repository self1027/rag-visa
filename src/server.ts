import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { askRAG, ChatMessage } from './rag/generator.js';
import { chatLimiter } from './middleware/rateLimiter.js';
import { enforceTokenLimit } from './middleware/tokenLimiter.js';

const app = express();
const PORT = Number(process.env.PORT) || 3333;
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'manifest.json');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

interface ChatRequestBody {
  history: ChatMessage[];
}

app.get('/api/documents', (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      return res.status(404).json({ error: 'Arquivo manifest.json não encontrado.' });
    }

    const rawData = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(rawData);

    const documents = Object.entries(manifest).map(([filename, metadata]: [string, any]) => ({
      filename,
      ...metadata
    }));

    return res.json({
      total: documents.length,
      documents
    });
  } catch (error: any) {
    console.error('Erro ao ler o manifesto de documentos:', error);
    return res.status(500).json({ error: 'Erro interno ao carregar os documentos.' });
  }
});

app.get('/api/documents/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename;
  const filePath = path.join(process.cwd(), 'data', 'pdfs', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo PDF não encontrado.' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});

app.post('/api/chat', chatLimiter, async (req: Request<{}, {}, ChatRequestBody>, res: Response) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando e acessível na rede na porta ${PORT}`);
});