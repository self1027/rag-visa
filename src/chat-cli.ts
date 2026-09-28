import 'dotenv/config';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { askRAG, ChatMessage } from './rag/generator.js';

async function runChatCLI() {
  const rl = readline.createInterface({ input, output });
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

      // Adiciona a pergunta do usuário ao histórico
      chatHistory.push({ role: 'user', content: question });

      process.stdout.write('\n🤖 Assistente: ');

      try {
        // Envia o histórico completo para o RAG
        const result = await askRAG(chatHistory, (chunk) => {
          process.stdout.write(chunk);
        });

        // Adiciona a resposta da IA ao histórico para manter a memória das próximas perguntas
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
        // Remove a última pergunta do usuário do histórico se falhou
        chatHistory.pop();
      }
    }
  } finally {
    rl.close();
  }
}

runChatCLI();