import { askRAG } from './rag/generator.js';

async function runCLI() {
  const query = process.argv[2] || "Quais são as obrigações do empregador em relação aos riscos à saúde do trabalhador?";

  console.log(`\n🔎 Pergunta: "${query}"`);
  console.log('🤖 Consultando RAG (Qdrant + Qwen2.5 3B)...\n');
  process.stdout.write('🗣️  Resposta: ');

  try {
    const result = await askRAG(query, (chunk) => {
      process.stdout.write(chunk);
    });

    console.log('\n\n📚 Fontes Consultadas:');
    result.sources.forEach((s) => {
      console.log(` - ${s.artigo} (Relevância: ${(s.score * 100).toFixed(1)}%) [${s.fonte}]`);
    });
  } catch (error) {
    console.error('\n❌ Erro durante execução do RAG:', error);
  }
}

runCLI();