import 'dotenv/config';
import OpenAI from 'openai';
import { searchLegislacao } from '../retriever/search.js';
import { analyzeAndNormalizeQuery } from './normalizer.js';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error('A chave GROQ_API_KEY não foi encontrada no arquivo .env');
}

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: apiKey,
});

const SYSTEM_PROMPT = `Você é um assistente especializado em Vigilância Sanitária (VISA).
Sua tarefa é responder a dúvidas de fiscais e munícipes com base nos trechos da legislação fornecidos no contexto ou gerenciar o fluxo da conversa.

Regras Fundamentais:
1. Baseie sua resposta estritamente nos artigos e diplomas legais fornecidos quando houver uma consulta técnica.
2. SEMPRE cite o artigo específico acompanhado obrigatoriamente do nome da norma de origem. NUNCA cite apenas o número do artigo isoladamente.
3. Mantenha o contexto da conversa: se o usuário estiver fazendo uma pergunta complementar (ex: "e se for tinta..."), lembre-se do assunto principal discutido nas mensagens anteriores (ex: área de manipulação de alimentos).
4. **EXCEÇÃO PARA INTERAÇÃO SOCIAL E CONVERSAÇÃO**: Se a mensagem do usuário for uma saudação (ex: "bom dia", "olá"), cortesia (ex: "obrigado"), ou uma pergunta sobre o chat/contexto que não envolva matéria técnica de legislação, **responda de forma educada, prestativa e natural**, sem invocar a ausência de embasamento legal.
5. Se o contexto fornecido para uma dúvida técnica não contiver a resposta, diga claramente: "Não encontrei embasamento para essa pergunta na legislação cadastrada."
6. Seja direto, técnico e utilize linguagem jurídica/sanitária precisa apenas quando o tema for a legislação.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askRAG(
  history: ChatMessage[],
  onChunk?: (chunk: string) => void
) {
  const lastUserMessage = history.filter(h => h.role === 'user').pop();
  if (!lastUserMessage) {
    throw new Error('Nenhuma mensagem de usuário encontrada no histórico.');
  }

  // 1. Analisa se a pergunta exige nova busca e normaliza em uma única passada otimizada
  const analysis = await analyzeAndNormalizeQuery(history);

  let contextHits: any[] = [];
  let normalizedQuery = analysis.normalizedQuery;

  if (analysis.needsSearch) {
    contextHits = await searchLegislacao(normalizedQuery, { 
      limit: 6, 
      scoreThreshold: 0.25 
    });
  }

  const contextText = contextHits.length > 0 
    ? contextHits.map((hit, index) => {
        const normaInfo = [hit.fonte_pdf, hit.esfera].filter(Boolean).join(' - ');
        const cabecalhoNorma = normaInfo ? ` - Norma/Origem: ${normaInfo}` : '';
        return `--- Trecho [${index + 1}] (${hit.artigo}${cabecalhoNorma}) ---\n${hit.content}`;
      }).join('\n\n')
    : (analysis.needsSearch ? "Nenhum trecho específico encontrado na base para esta consulta." : "Utilize o contexto da legislação discutida nas mensagens anteriores.");

  const messagesForGroq: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
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