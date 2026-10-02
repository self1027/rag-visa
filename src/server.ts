import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { askRAG, ChatMessage } from './rag/generator.js';

const app = express();
const PORT = process.env.PORT || 3333;

app.use(cors());
app.use(express.json());

interface ChatRequestBody {
  history: ChatMessage[];
}

app.post('/api/chat', async (req: Request<{}, {}, ChatRequestBody>, res: Response) => {
  const { history } = req.body;

  if (!history || !Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'O histórico de mensagens é obrigatório.' });
  }

  // Permitindo (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Executa a função askRAG passando um callback de chunk para enviar os pedaços via SSE
    const result = await askRAG(history, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    });

    // Ao finalizar, envia as fontes consultadas e encerra a conexão
    res.write(`data: ${JSON.stringify({ type: 'sources', sources: result.sources, normalizedQuery: result.normalizedQuery })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Erro na API de chat:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'Erro interno no servidor' })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});