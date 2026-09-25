import { askRAG } from './rag/generator.js';

async function runCLI() {
  const query = process.argv[2];
  
  try {
    const result = await askRAG(query, (chunk) => {
      process.stdout.write(chunk);
    });

    result.sources.forEach((s) => {
      console.log(` - ${s.artigo} (Relevância: ${(s.score * 100).toFixed(1)}%) [${s.fonte}]`);
    });
  } catch (error) {
    console.error('\nErro durante execução do RAG:', error);
  }
}

runCLI();