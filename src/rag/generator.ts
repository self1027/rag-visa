import 'dotenv/config';
import OpenAI from 'openai';
import { searchLegislacao } from '../retriever/search.js';
import { normalizeQuery } from './normalizer.js';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error('A chave GROQ_API_KEY não foi encontrada no arquivo .env');
}

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: apiKey,
});

const SYSTEM_PROMPT = `Você é um assistente especializado e rigoroso em Vigilância Sanitária (VISA).
Sua tarefa é responder a dúvidas de fiscais e munícipes com base EXCLUSIVAMENTE nos trechos da legislação fornecidos no contexto.

Regras Fundamentais:
1. Baseie sua resposta estritamente nos artigos e diplomas legais fornecidos.
2. SEMPRE cite o artigo específico acompanhado obrigatoriamente do nome da norma de origem. NUNCA cite apenas o número do artigo isoladamente.
3. Mantenha o contexto da conversa: se o usuário estiver fazendo uma pergunta complementar (ex: "e se for tinta..."), lembre-se do assunto principal discutido nas mensagens anteriores (ex: área de manipulação de alimentos).
4. Se o contexto fornecido não contiver a resposta, diga claramente: "Não encontrei embasamento para essa pergunta na legislação cadastrada."
5. Seja direto, técnico e utilize linguagem jurídica/sanitária precisa.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askRAG(
  history: ChatMessage[],
  onChunk?: (chunk: string) => void
) {
  // Pega a última mensagem enviada pelo usuário para fazer a busca no Qdrant
  const lastUserMessage = history.filter(h => h.role === 'user').pop();
  if (!lastUserMessage) {
    throw new Error('Nenhuma mensagem de usuário encontrada no histórico.');
  }

  const normalizedQuery = await normalizeQuery(lastUserMessage.content);

  // Busca os trechos legais com base na última pergunta normalizada
  const contextHits = await searchLegislacao(normalizedQuery, { 
    limit: 6, 
    scoreThreshold: 0.25 
  });

  const contextText = contextHits.length > 0 
    ? contextHits.map((hit, index) => {
        const normaInfo = [hit.fonte_pdf, hit.esfera].filter(Boolean).join(' - ');
        const cabecalhoNorma = normaInfo ? ` - Norma/Origem: ${normaInfo}` : '';
        return `--- Trecho [${index + 1}] (${hit.artigo}${cabecalhoNorma}) ---\n${hit.content}`;
      }).join('\n\n')
    : "Nenhum trecho específico encontrado na base para esta consulta.";

  // Injetamos o contexto legislativo na última mensagem do usuário ou como um system prompt dinâmico
  const messagesForGroq: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    // Adiciona o histórico anterior (exceto a última, que vamos tratar com o contexto)
    ...history.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
    // Adiciona a última mensagem do usuário envelopada com o contexto legislativo recuperado
    { 
      role: 'user', 
      content: `Contexto Legislativo Recuperado:\n${contextText}\n\nPergunta atual do Fiscal/Munícipe: ${lastUserMessage.content}` 
    }
  ];

  const responseStream = await groqClient.chat.completions.create({
    model: 'qwen/qwen3.8-27b',
    messages: messagesForGroq,
    temperature: 0.1,
    max_tokens: 1000,
    stream: true,
  });

  let fullAnswer = '';

  for await (const chunk of responseStream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      fullAnswer += text;
      if (onChunk) {
        onChunk(text);
      }
    }
  }

  return {
    answer: fullAnswer,
    normalizedQuery: normalizedQuery,
    sources: contextHits.map((h) => ({ artigo: h.artigo, score: h.score, fonte: h.fonte_pdf })),
  };
}