# RAG VISA

Assistente inteligente e sistema de Recuperação Aumentada por Geração (RAG) especializado em legislacao de Vigilancia Sanitaria (VISA). Desenvolvido para apoiar fiscais, tecnicos e municipes na consulta rapida e precisa de leis municipais, estaduais e federais.

---

## Tecnologias e Arquitetura

O projeto foi construido utilizando uma stack moderna em TypeScript:

* **Qdrant**: Banco de dados vetorial para armazenamento e busca por similaridade dos trechos legais.
* **Ollama**: Execucao local de modelos de embeddings (`bge-m3` com dimensao nativa de 1024).
* **Groq API (Qwen)**: LLM de alta performance utilizada para normalizacao de consultas e geracao de respostas baseadas em contexto.
* **pdf-parse-new**: Extracao de texto de documentos normativos em formato PDF.

---

## Pre-requisitos

1. **Node.js** instalado (versao 18+ recomendada).
2. **Ollama** rodando localmente na porta `11434` com o modelo de embedding baixado:
```bash
ollama pull bge-m3

```


3. **Qdrant** rodando (via Docker ou nativo) na porta `6333`:
```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant

```


4. Uma chave de API da **Groq** configurada em um arquivo `.env`.

---

## Configuracao do Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto com a seguinte variavel:

```env
GROQ_API_KEY=sua_chave_da_groq_aqui
OLLAMA_URL=http://localhost:11434

```

---

## Como Executar

### 1. Instalacao das Dependencias

```bash
npm install

```

### 2. Ingestao de Documentos (PDFs)

Coloque os arquivos PDF de legislacao na pasta `data/pdfs/` e, opcionalmente, ajuste os metadados no arquivo `data/manifest.json`. Em seguida, execute a ingestao:

```bash
npm run ingest

```

### 3. Executando o Chat Interativo (CLI)

Inicie o assistente de perguntas e respostas no terminal:

```bash
npm run chat

```