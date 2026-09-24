import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { qdrantClient, COLLECTION_NAME, setupQdrantCollection } from '../config/qdrant.js';
import { generateEmbedding } from '../config/ollama.js';
import { chunkLegislacao } from '../utils/chunker.js';
import pdfParse from 'pdf-parse-new';

const PDF_DIR = path.join(process.cwd(), 'data', 'pdfs');
const BATCH_SIZE = 25; // Tamanho do lote para upsert no Qdrant

export async function processPdfs() {
  await setupQdrantCollection();

  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  const files = fs.readdirSync(PDF_DIR).filter((file) => file.endsWith('.pdf'));

  if (files.length === 0) {
    console.log(`⚠️ Nenhum ficheiro PDF encontrado na pasta: ${PDF_DIR}`);
    return;
  }

  for (const file of files) {
    console.log(`\n📄 Processando arquivo: ${file}`);
    const filePath = path.join(PDF_DIR, file);
    const dataBuffer = fs.readFileSync(filePath);

    const pdfData = await pdfParse(dataBuffer);
    console.log(`- Texto extraído (${pdfData.text.length} caracteres).`);

    const chunks = chunkLegislacao(pdfData.text, file);
    console.log(`- Gerados ${chunks.length} chunks com metadados.`);

    console.log('- Gerando embeddings e preparando pontos...');
    
    const points = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Embedding via Ollama (bge-m3)
      const vector = await generateEmbedding(chunk.content);

      points.push({
        id: uuidv4(),
        vector,
        payload: {
          content: chunk.content,
          artigo: chunk.metadata.artigo,
          livro: chunk.metadata.livro ?? null,
          titulo: chunk.metadata.titulo ?? null,
          capitulo: chunk.metadata.capitulo ?? null,
          secao: chunk.metadata.secao ?? null,
          tipo_documento: chunk.metadata.tipo_documento,
          esfera: chunk.metadata.esfera,
          fonte_pdf: chunk.metadata.fonte_pdf,
        },
      });

      process.stdout.write(`  Embeddings: ${i + 1}/${chunks.length}\r`);
    }

    console.log('\n- Inserindo lotes no Qdrant...');

    // Upsert em lotes (Batch processing)
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      await qdrantClient.upsert(COLLECTION_NAME, {
        wait: true,
        points: batch,
      });
      console.log(`  Enviados ${Math.min(i + BATCH_SIZE, points.length)}/${points.length} pontos.`);
    }

    console.log(`✅ ${file} indexado com sucesso!`);
  }
}

// Verificação de execução direta compatível com ESM/tsx
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  processPdfs().catch(console.error);
}