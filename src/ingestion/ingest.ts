import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { qdrantClient, COLLECTION_NAME, setupQdrantCollection } from '../config/qdrant.js';
import { generateEmbedding } from '../config/ollama.js';
import { chunkLegislacao } from '../utils/chunker.js';
import pdfParse from 'pdf-parse-new';
import { db } from '../db/index.js';
import { documentsTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const PDF_DIR = path.join(process.cwd(), 'data', 'pdfs');
const BATCH_SIZE = 25;
const EMBEDDING_CONCURRENCY = 1;

export async function processPdfs() {
  await setupQdrantCollection();

  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  // Busca todos os documentos cadastrados no SQLite
  const dbDocuments = db.select().from(documentsTable).all();
  const metadataMap = new Map(dbDocuments.map(doc => [doc.filename, doc]));

  const files = fs.readdirSync(PDF_DIR).filter((file) => file.endsWith('.pdf'));

  if (files.length === 0) {
    console.log(`Nenhum ficheiro PDF encontrado na pasta: ${PDF_DIR}`);
    return;
  }

  const summaryReport: Array<{ file: string; esfera: string; tipo: string; chunksCount: number }> = [];

  for (const file of files) {
    console.log(`\nProcessando arquivo: ${file}`);
    
    // Procura os metadados no mapa carregado do SQLite (com fallbacks se não cadastrado)
    const fileMetadata = metadataMap.get(file);
    const esfera = fileMetadata?.esfera || 'municipal';
    const tipoDocumento = fileMetadata?.tipo || 'legislacao';
    const tituloAmigavel = fileMetadata?.titulo || file;

    console.log(`- Metadados do Banco -> Esfera: ${esfera} | Tipo: ${tipoDocumento} | Titulo: ${tituloAmigavel}`);

    const filePath = path.join(PDF_DIR, file);
    const dataBuffer = fs.readFileSync(filePath);

    const pdfData = await pdfParse(dataBuffer);
    console.log(`- Texto extraido (${pdfData.text.length} caracteres).`);

    const chunks = chunkLegislacao(pdfData.text, file);
    console.log(`- Gerados ${chunks.length} chunks com metadados.`);

    console.log('- Gerando embeddings e preparando pontos...');
    
    const points = [];

    for (let i = 0; i < chunks.length; i += EMBEDDING_CONCURRENCY) {
      const batchChunks = chunks.slice(i, i + EMBEDDING_CONCURRENCY);

      const batchPoints = await Promise.all(
        batchChunks.map(async (chunk) => {
          const vector = await generateEmbedding(chunk.content);

          return {
            id: uuidv4(),
            vector,
            payload: {
              content: chunk.content,
              artigo: chunk.metadata.artigo,
              livro: chunk.metadata.livro || undefined,
              titulo: chunk.metadata.titulo || undefined,
              capitulo: chunk.metadata.capitulo || undefined,
              secao: chunk.metadata.secao || undefined,
              tipo_documento: tipoDocumento,
              esfera: esfera,
              fonte_pdf: tituloAmigavel,
            },
          };
        })
      );

      points.push(...batchPoints);
      process.stdout.write(`  Embeddings: ${points.length}/${chunks.length}\r`);
    }

    console.log('\n- Inserindo lotes no Qdrant...');

    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      await qdrantClient.upsert(COLLECTION_NAME, {
        wait: true,
        points: batch,
      });
      console.log(`  Enviados ${Math.min(i + BATCH_SIZE, points.length)}/${points.length} pontos.`);
    }

    console.log(`${file} indexado com sucesso!`);
    
    summaryReport.push({
      file,
      esfera,
      tipo: tipoDocumento,
      chunksCount: chunks.length,
    });
  }

  // Overall Final da Ingestao
  console.log('\n========================================');
  console.log('OVERALL DA INGESTAO DE LEIS');
  console.log('========================================');
  console.log(`Total de arquivos processados com sucesso: ${summaryReport.length}`);
  console.log('----------------------------------------');
  summaryReport.forEach((item, idx) => {
    console.log(`${idx + 1}. Arquivo: ${item.file}`);
    console.log(`    - Esfera mapeada: ${item.esfera}`);
    console.log(`    - Tipo: ${item.tipo}`);
    console.log(`    - Chunks gerados: ${item.chunksCount}`);
  });
  console.log('========================================\n');
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  processPdfs().catch(console.error);
}