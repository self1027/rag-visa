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

---

## Pré-requisitos

1. **Node.js** instalado (versão 18+ recomendada).
2. **Ollama** rodando localmente na porta `11434` com o modelo de embedding baixado:
   ```bash
   ollama pull bge-m3
    ```

3. **Qdrant** rodando (via Docker ou nativo) na porta `6333`:
    ```bash
    docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
    ```


4. Uma chave de API da **Groq** configurada no arquivo `.env`.

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

Coloque os arquivos PDF de legislação na estrutura de dados do projeto e execute a ingestão:

```bash
npm run ingest

```

### 3. Executando o Servidor de Desenvolvimento (API RAG com Streaming)

Inicie o servidor HTTP para a interface web com suporte a Server-Sent Events (SSE):

```bash
npm run dev:server

```

### 4. Executando o Chat Interativo no Terminal (CLI)

Caso queira testar diretamente pelo console:

```bash
npm run chat

```