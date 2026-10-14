import { log } from '../observability/index.js';
import { settings } from '../config/settings.js';
import 'dotenv/config';
import OpenAI from 'openai';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error('A chave GROQ_API_KEY não foi encontrada no arquivo .env');
}

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: apiKey,
  timeout: settings.requestTimeoutMs,
  maxRetries: 1,
});

const ROUTER_NORMALIZER_PROMPT = `Você é um analisador JSON estrito para um sistema RAG de Vigilância Sanitária.
Sua ÚNICA função é retornar um objeto JSON válido, sem NENHUM texto adicional, sem saudações e sem blocos de markdown (\`\`\`json).

Regras:
1. "needs_search": 
   - true se a pergunta traz um novo tema, assunto ou termo técnico de vigilância sanitária / legislação não respondido antes.
   - false se for uma saudação (ex: "bom dia", "olá"), cortesia (ex: "obrigado"), conversa casual, ou continuação/pedido de formatação da resposta anterior.
2. "normalized_query": Se needs_search for true, resuma a pergunta em uma frase CURTA e altamente técnica focada em termos legais (ex: "armazenamento de alimentos RDC 216"). Máximo de 15 palavras. Se for false, deixe "".

Retorne APENAS o JSON no formato exato abaixo:
{"needs_search": false, "normalized_query": ""}`;

export interface AnalysisResult {
  needsSearch: boolean;
  normalizedQuery: string;
}

export async function analyzeAndNormalizeQuery(history: Array<{ role: string; content: string }>, signal?: AbortSignal): Promise<AnalysisResult> {
  try {
    if (history.length <= 1) {
      const lastMsg = history[history.length - 1]?.content || '';
      const fallbackNormalized = await directNormalize(lastMsg, signal);
      return { needsSearch: true, normalizedQuery: fallbackNormalized };
    }

    const lastUserMessage = history[history.length - 1].content;
    const previousAssistantMessage = history[history.length - 2]?.content || '';

    const response = await groqClient.chat.completions.create({
      model: settings.groqModel,
      messages: [
        { role: 'system', content: ROUTER_NORMALIZER_PROMPT },
        { 
          role: 'user', 
          content: `Histórico recente - IA: "${previousAssistantMessage.slice(0, 200)}..."\nUsuário: "${lastUserMessage}"` 
        }
      ],
      temperature: 0.0,
      max_tokens: 150,
      response_format: { type: "json_object" }
    }, { signal });


    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error('Resposta vazia do modelo de roteamento.');

    // Remove any markdown formatting in case the model disobeys
    const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);
    if (typeof parsed.needs_search !== 'boolean' || typeof parsed.normalized_query !== 'string') throw new Error('Resposta de roteamento inválida.');

    // When needs_search is false, normalized_query should be empty string per the prompt
    let finalQuery = parsed.needs_search ? (parsed.normalized_query || lastUserMessage) : '';
    
    // SAFETY LOCK: If the normalized query comes back too long (ex: the model dumped text into it), 
    // we truncate it or fall back to the original user message to avoid corrupting Qdrant.
    if (parsed.needs_search && (finalQuery.length > 200 || finalQuery.includes('Aqui está'))) {
      finalQuery = lastUserMessage;
    }

    return {
      needsSearch: Boolean(parsed.needs_search),
      normalizedQuery: finalQuery
    };

  } catch (error) {
    signal?.throwIfAborted();
    log('router_fallback', { errorType: error instanceof Error ? error.name : 'unknown' });
    const lastMsg = history[history.length - 1]?.content || '';
    return { needsSearch: true, normalizedQuery: lastMsg };
  }
}

async function directNormalize(userQuestion: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await groqClient.chat.completions.create({
      model: settings.groqModel,
      messages: [
        { role: 'system', content: 'Você é um especialista em terminologia de Vigilância Sanitária. Reescreva a pergunta do usuário em uma consulta técnica curta e direta, de no máximo 15 palavras, focada em legislação.' },
        { role: 'user', content: userQuestion },
      ],
      temperature: 0.0,
      max_tokens: 60,
    }, { signal });
    const result = response.choices[0]?.message?.content?.trim();
    return (result && result.length < 200) ? result : userQuestion;
  } catch {
    signal?.throwIfAborted();
    return userQuestion;
  }
}