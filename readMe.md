# RAG VISA

Assistente inteligente e sistema de Recuperação Aumentada por Geração (RAG) especializado em legislação de Vigilância Sanitária (VISA). Desenvolvido para apoiar fiscais, técnicos e munícipes na consulta rápida e precisa de leis municipais, estaduais e federais com alta fluidez e economia de tokens.

---

## Tecnologias e Arquitetura

O projeto foi construído utilizando uma stack moderna em TypeScript:

* **Qdrant**: Banco de dados vetorial para armazenamento e busca por similaridade dos trechos legais.
* **Ollama**: Execução local de modelos de embeddings (`bge-m3`).
* **Groq API (Qwen 3.8 27B)**: LLM de alta performance utilizada tanto na camada de **Roteamento Inteligente e Normalização de Consultas** quanto na **Geração de Respostas**.
* **Intent Router / Bypass**: Mecanismo inteligente que detecta perguntas de continuação (*follow-ups*, resumos, formatações), pulando consultas vetoriais desnecessárias no Qdrant para garantir latência zero e economia de recursos.
* **Express & SSE (Server-Sent Events)**: Servidor HTTP para streaming de respostas em tempo real para a interface web.
* **SQLite + Drizzle ORM**: Persistência dos metadados dos documentos (título, esfera, tipo, ano, órgão) em banco local.

---

## Pré-requisitos

1. **Node.js** instalado (versão 18+ recomendada).
2. **Docker** e **Docker Compose** instalados (para subir Qdrant e Ollama).
3. Uma chave de API da **Groq** configurada no arquivo `.env`.

---

## Subindo a Infraestrutura com Docker Compose

O projeto inclui um `docker-compose.yml` que sobe o **Qdrant** e o **Ollama** já configurados e conectados na mesma rede:

```bash
docker compose up -d
```

Isso irá iniciar:

| Serviço | Container | Portas | Descrição |
|---|---|---|---|
| `qdrant` | `qdrant_visa` | `6333` (REST/Dashboard), `6334` (gRPC) | Banco vetorial com volume persistente em `./qdrant_storage` |
| `ollama` | `ollama_visa` | `11434` | Runtime de embeddings com volume nomeado `ollama_storage` |

### Baixando o modelo de embeddings

Após o container do Ollama estar em execução, baixe o modelo `bge-m3` (usado na geração de embeddings) diretamente dentro do container:

```bash
docker exec -it ollama_visa ollama pull bge-m3
```

Para verificar se o modelo foi baixado corretamente:

```bash
docker exec -it ollama_visa ollama list
```

> **Dica:** para acompanhar os logs dos serviços:
> ```bash
> docker compose logs -f
> ```
> Para derrubar a stack (mantendo os volumes):
> ```bash
> docker compose down
> ```

### Alternativa sem Docker Compose

Caso prefira rodar os serviços manualmente:

**Ollama:**
```bash
ollama serve
ollama pull bge-m3
```

**Qdrant:**
```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

---

## Configuração do Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
GROQ_API_KEY=sua_chave_da_groq_aqui
OLLAMA_URL=http://localhost:11434
PORT=3333
```

---

## Como Executar

### 1. Instalação das Dependências

```bash
npm install
```

### 2. Ingestão de Documentos (PDFs)

Coloque os arquivos PDF de legislação na pasta `data/pdfs/` e execute a ingestão:

```bash
npm run ingest
```

O script irá:

1. Ler os metadados cadastrados no SQLite (via `documentsTable`).
2. Extrair o texto de cada PDF.
3. Dividir em chunks com metadados hierárquicos (artigo, livro, título, capítulo, seção).
4. Gerar embeddings com `bge-m3` via Ollama.
5. Inserir os pontos no Qdrant em lotes.

> Para popular o banco de metadados a partir do dicionário pré-definido, execute:
> ```bash
> npx tsx src/utils/migration.ts
> ```

### 3. Executando o Servidor de Desenvolvimento (API RAG com Streaming)

Inicie o servidor HTTP com suporte a Server-Sent Events (SSE):

```bash
npm run dev:server
```

Endpoints principais:

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/documents` | Lista todos os documentos cadastrados |
| `GET` | `/api/documents/:filename` | Faz download/stream de um PDF |
| `POST` | `/api/documents` | Cadastra um novo documento (multipart) |
| `PUT` | `/api/documents/:filename` | Atualiza metadados e/ou PDF |
| `DELETE` | `/api/documents/:filename` | Remove documento e PDF |
| `POST` | `/api/chat` | Chat com streaming SSE (rate limit: 5 req/min) |

### 4. Executando o Chat Interativo no Terminal (CLI)

Caso queira testar diretamente pelo console, sem interface web:

```bash
npm run chat
```

---

## Scripts Disponíveis

| Comando | Descrição |
|---|---|
| `npm run chat` | Inicia o chat interativo no terminal |
| `npm run ingest` | Processa os PDFs e popula o Qdrant |
| `npm run dev:server` | Sobe o servidor Express com hot-reload |
| `npm run test:db` | Inspeciona a coleção do Qdrant (contagem, dimensão, amostra) |
| `npm test` | Executa a suíte de testes (Vitest) |
| `npm run test:watch` | Executa os testes em modo watch |
| `npm run test:coverage` | Executa os testes com relatório de cobertura |
| `npm run typecheck` | Verifica os tipos TypeScript sem emitir arquivos |

---

## Estrutura do Projeto

```
.
├── docker-compose.yml        # Qdrant + Ollama
├── data/
│   ├── database.sqlite       # Metadados dos documentos (criado em runtime)
│   └── pdfs/                 # PDFs de legislação
├── qdrant_storage/           # Volume persistente do Qdrant
├── src/
│   ├── server.ts             # API Express + SSE
│   ├── chat-cli.ts           # Chat interativo no terminal
│   ├── test-db.ts            # Inspeção do Qdrant
│   ├── config/
│   │   ├── ollama.ts         # Cliente Ollama + generateEmbedding
│   │   └── qdrant.ts         # Cliente Qdrant + setup da coleção
│   ├── db/
│   │   ├── index.ts          # Conexão SQLite + Drizzle
│   │   └── schema.ts         # Schema documentsTable
│   ├── ingestion/
│   │   └── ingest.ts         # Pipeline de ingestão de PDFs
│   ├── middleware/
│   │   ├── rateLimiter.ts    # Rate limit do /api/chat
│   │   └── tokenLimiter.ts   # Corte de histórico por tokens
│   ├── rag/
│   │   ├── generator.ts      # askRAG (streaming + contexto)
│   │   └── normalizer.ts     # Roteamento + normalização de query
│   ├── retriever/
│   │   └── search.ts         # Busca vetorial com filtros
│   └── utils/
│       ├── chunker.ts        # Chunking por artigo + hierarquia
│       └── migration.ts      # Seed de metadados
└── tests/
    ├── setup.ts              # Configuração global do Vitest
    ├── integration/          # Testes da API HTTP
    └── unit/                 # Testes unitários
```

---

## Testes

A suíte cobre unidade e integração com Vitest:

```bash
npm test
```

Áreas cobertas:

- **Unitários**: `search`, `generator`, `normalizer`, `chunker`, `tokenLimiter`, `rateLimiter`, `ollama`, `qdrant`, `schema`, `ingestion`, `cli`.
- **Integração**: rotas HTTP de documentos (CRUD + upload) e `/api/chat` (streaming SSE, validação, rate limit, token limit).

---

## Licença

ISC