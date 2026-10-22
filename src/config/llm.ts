import OpenAI from 'openai';
import { settings } from './settings.js';

let client: OpenAI | undefined;
export function getLlmClient(): OpenAI {
  if (!settings.llmBaseUrl || !settings.llmModel || !settings.llmApiKey) {
    throw new Error('Configure LLM_BASE_URL, LLM_MODEL e LLM_API_KEY (GROQ_MODEL e GROQ_API_KEY também são aceitos).');
  }
  return client ??= new OpenAI({
    baseURL: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    timeout: settings.requestTimeoutMs,
    maxRetries: settings.llmMaxRetries,
  });
}
