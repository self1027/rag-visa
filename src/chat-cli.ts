import 'dotenv/config';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { askRAG, ChatMessage } from './rag/generator.js';

export async function runChatCLI(
  customInput = input,
  customOutput = output,
  customAskRAG = askRAG
) {
  const rl = readline.createInterface({ input: customInput, output: customOutput });
  const chatHistory: ChatMessage[] = [];

  console.log('==================================================');
  console.log('🤖 Assistente RAG - Vigilância Sanitária (VISA)');
  console.log('Digite sua pergunta ou "sair" para encerrar.');
  console.log('==================================================\n');

  try {
    while (true) {
      const question = await rl.question('\n👤 Usuário: ');
      
      if (!question || question.trim().toLowerCase() === 'sair') {
        console.log('\nEncerrando assistente. Até logo!');
        break;
      }

      if (question.trim() === '') continue;

      // Add the user question to the history
      chatHistory.push({ role: 'user', content: question });

      customOutput.write('\n🤖 Assistente: ');

      try {
        // Send the full history to RAG
        const result = await customAskRAG(chatHistory, (chunk) => {
          customOutput.write(chunk);
        });

        // Add the AI response to the history to keep memory for the next questions
        chatHistory.push({ role: 'assistant', content: result.answer });

        console.log('\n\n📚 Fontes Consultadas:');
        if (result.sources.length === 0) {
          console.log(' - Nenhuma fonte referenciada.');
        } else {
          const uniqueSources = Array.from(
            new Set(result.sources.map(s => `${s.artigo} [${s.fonte}] (Relevância: ${(s.score * 100).toFixed(1)}%)`))
          );
          uniqueSources.forEach((src) => console.log(` - ${src}`));
        }
      } catch (error) {
        console.error('\n❌ Erro ao processar a pergunta:', error);
        // Remove the last user question from the history if it failed
        chatHistory.pop();
      }
    }
  } finally {
    rl.close();
  }
}

// Only run if this is the main module (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  runChatCLI();
}