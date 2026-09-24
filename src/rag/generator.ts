import { ollamaClient } from '../config/ollama.js';
import { searchLegislacao } from '../retriever/search.js';

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
  // 1. Retrieval
  const contextHits = await searchLegislacao(question, { limit: 4, scoreThreshold: 0.35 });

  if (contextHits.length === 0) {
    return {
      answer: "Não foram encontrados artigos relevantes na base de dados para responder a esta questão.",
      sources: []
    };
  }

  // 2. Augment Context
  const contextText = contextHits
    .map((hit, index) => `--- Trecho [${index + 1}] (${hit.artigo}) ---\n${hit.content}`)
    .join('\n\n');

  const userPrompt = `Contexto Legislativo:\n${contextText}\n\nPergunta do Fiscal: ${question}`;

  // 3. Streaming Response via Ollama (Qwen2.5 3B)
  const responseStream = await ollamaClient.generate({
    model: 'qwen2.5:3b',
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    stream: true,
    options: {
      temperature: 0.1,
      num_predict: 400,
    },
  });

  let fullAnswer = '';

  for await (const part of responseStream) {
    fullAnswer += part.response;
    if (onChunk) {
      onChunk(part.response);
    }
  }

  return {
    answer: fullAnswer,
    sources: contextHits.map((h) => ({ artigo: h.artigo, score: h.score, fonte: h.fonte_pdf })),
  };
}