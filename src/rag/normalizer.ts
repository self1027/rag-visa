import 'dotenv/config';
import OpenAI from 'openai';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error('A chave GROQ_API_KEY não foi encontrada no arquivo .env');
}

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: apiKey,
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

export async function analyzeAndNormalizeQuery(history: Array<{ role: string; content: string }>): Promise<AnalysisResult> {
  try {
    if (history.length <= 1) {
      const lastMsg = history[history.length - 1]?.content || '';
      const fallbackNormalized = await directNormalize(lastMsg);
      return { needsSearch: true, normalizedQuery: fallbackNormalized };
    }

    const lastUserMessage = history[history.length - 1].content;
    const previousAssistantMessage = history[history.length - 2]?.content || '';

    const response = await groqClient.chat.completions.create({
      model: 'qwen/qwen3.8-27b',
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
    });
    console.log('Resposta do roteador inteligente:', response.choices[0]?.message?.content);

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error('Resposta vazia do modelo de roteamento.');

    // Remove eventuais marcações de markdown caso o modelo desobedeça
    const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    let finalQuery = parsed.normalized_query || lastUserMessage;
    
    // TRAVA DE SEGURANÇA: Se a query normalizada vier muito longa (ex: o modelo despejou texto nela), 
    // cortamos ou usamos a mensagem original do usuário para evitar corromper o Qdrant.
    if (finalQuery.length > 200 || finalQuery.includes('Aqui está')) {
      finalQuery = lastUserMessage;
    }

    return {
      needsSearch: Boolean(parsed.needs_search),
      normalizedQuery: finalQuery
    };

  } catch (error) {
    console.error('Falha no roteador inteligente. Usando fallback padrão:', error);
    const lastMsg = history[history.length - 1]?.content || '';
    return { needsSearch: true, normalizedQuery: lastMsg };
  }
}

async function directNormalize(userQuestion: string): Promise<string> {
  try {
    const response = await groqClient.chat.completions.create({
      model: 'qwen/qwen3.8-27b',
      messages: [
        { role: 'system', content: 'Você é um especialista em terminologia de Vigilância Sanitária. Reescreva a pergunta do usuário em uma consulta técnica curta e direta, de no máximo 15 palavras, focada em legislação.' },
        { role: 'user', content: userQuestion },
      ],
      temperature: 0.0,
      max_tokens: 60,
    });
    const result = response.choices[0]?.message?.content?.trim();
    return (result && result.length < 200) ? result : userQuestion;
  } catch {
    return userQuestion;
  }
}