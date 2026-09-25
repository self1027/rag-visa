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

const NORMALIZER_SYSTEM_PROMPT = `Você é um especialista em terminologia de Vigilância Sanitária (VISA).
Sua tarefa é REESCREVER e ENRIQUECER perguntas informais de usuários, transformando-as em uma consulta altamente técnica utilizando o vocabulário oficial da legislação sanitária (ex: Código Sanitário Estadual, RDC Anvisa).`;

export async function normalizeQuery(userQuestion: string): Promise<string> {
  try {
    const response = await groqClient.chat.completions.create({
      model: 'qwen/qwen3.8-27b',
      messages: [
        { role: 'system', content: NORMALIZER_SYSTEM_PROMPT },
        { role: 'user', content: userQuestion },
      ],
      temperature: 0.0,
      max_tokens: 150,
      stream: false,
    });

    const normalized = response.choices[0]?.message?.content?.trim();
    
    return normalized && normalized.length > 0 ? normalized : userQuestion;
  } catch (error) {
    console.error('Falha ao normalizar consulta com LLM. Usando pergunta original:', error);
    return userQuestion;
  }
}