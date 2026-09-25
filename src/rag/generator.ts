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
1. Baseie sua resposta estritamente nos artigos fornecidos.
2. Sempre cite o artigo específico (ex: "Conforme o Artigo 112...").
3. Se o contexto fornecido não contiver a resposta, diga claramente: "Não encontrei embasamento para essa pergunta na legislação cadastrada."
4. Seja direto, técnico e utilize linguagem jurídica/sanitária precisa.`;

export async function askRAG(
  question: string,
  onChunk?: (chunk: string) => void
) {
  const normalizedQuestion = await normalizeQuery(question);

  const contextHits = await searchLegislacao(normalizedQuestion, { 
    limit: 3, 
    scoreThreshold: 0.35 
  });

  if (contextHits.length === 0) {
    return {
      answer: "Não foram encontrados artigos relevantes na base de dados para responder a esta questão.",
      normalizedQuery: normalizedQuestion,
      sources: []
    };
  }

  const contextText = contextHits
    .map((hit, index) => `--- Trecho [${index + 1}] (${hit.artigo}) ---\n${hit.content}`)
    .join('\n\n');

  const userPrompt = `Contexto Legislativo:\n${contextText}\n\nPergunta do Fiscal/Munícipe: ${question}`;

  const responseStream = await groqClient.chat.completions.create({
    model: 'qwen/qwen3.8-27b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 300,
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
    normalizedQuery: normalizedQuestion,
    sources: contextHits.map((h) => ({ artigo: h.artigo, score: h.score, fonte: h.fonte_pdf })),
  };
}