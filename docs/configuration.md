# Configuração

Copie [`.env.example`](../.env.example) para `.env` e configure o endpoint, a chave e o modelo de IA. A configuração central fica em [settings.ts](../src/config/settings.ts); caminhos de persistência e flags também são lidos nos respectivos componentes.

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `LLM_BASE_URL` | Obrigatória para o chat | URL completa da API compatível com OpenAI, incluindo `/v1` |
| `LLM_API_KEY` | Obrigatória para o chat | Credencial do provedor; para servidor local sem autenticação, use um valor não vazio |
| `LLM_MODEL` | Obrigatória para o chat | Modelo servido pelo endpoint |
| `LLM_MAX_RETRIES` | `1` | Repetições de chamadas transitórias |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_BASE_URL` | Sem padrão | Aliases; as variáveis `LLM_*` têm prioridade |
| `QDRANT_API_KEY` | Vazio | Credencial opcional do banco vetorial |
| `PORT` | `3333` | Porta HTTP |
| `TRUST_PROXY_HOPS` | `0` | Quantidade de proxies confiáveis para identificação do IP |
| `QDRANT_URL` | `http://localhost:6333` | Endpoint do Qdrant |
| `QDRANT_COLLECTION` | `legislacao_visa` | Coleção vetorial |
| `OLLAMA_URL` | `http://localhost:11434` | Endpoint do Ollama |
| `EMBEDDING_MODEL` | Obrigatória para embeddings | Modelo instalado no Ollama; o exemplo usa `bge-m3` |
| `EMBEDDING_CONTEXT_TOKENS` | `8192` | Contexto do modelo de embeddings |
| `INGESTION_BATCH_SIZE` | `25` | Quantidade de vetores por lote |
| `CHUNK_MAX_LENGTH` | `2500` | Limite de caracteres por trecho, incluindo cabeçalho |
| `CHUNK_OVERLAP` | `300` | Sobreposição; deve ser menor que `CHUNK_MAX_LENGTH - 4` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Janela do limite por IP |
| `RATE_LIMIT_MAX` | `5` | Requisições por janela |
| `EMBEDDING_DIMENSIONS` | `1024` | Dimensão esperada dos vetores |
| `DATABASE_PATH` | `data/database.sqlite` | Arquivo SQLite |
| `PDF_DIR` | `data/pdfs` | Diretório de PDFs para API e worker independente |
| `ADMIN_API_TOKEN` | Vazio | Bearer opcional para escrita, reingestão e métricas |
| `CORS_ORIGINS` | Vazio | Origens permitidas separadas por vírgula; vazio permite todas |
| `INGESTION_WORKER_IN_API` | `true` | Use `false` para separar API e workers |
| `WORKER_LEASE_MS` | `30000` | Prazo da concessão de uma tarefa |
| `WORKER_POLL_MS` | `1000` | Intervalo de consulta da fila |
| `REQUEST_TIMEOUT_MS` | `120000` | Timeout das chamadas aos serviços |
| `CHAT_TIMEOUT_MS` | `180000` | Timeout total do chat |
| `SEARCH_LIMIT` | `6` | Quantidade de resultados recuperados |
| `SEARCH_SCORE_THRESHOLD` | `0.3` | Similaridade mínima da recuperação |
| `MAX_HISTORY_TOKENS` | `5000` | Orçamento estimado do histórico |
| `MAX_RESPONSE_TOKENS` | `1000` | Limite de tokens da resposta |
| `UPLOAD_MAX_BYTES` | `26214400` | Limite por PDF: 25 MiB |
| `CONVERSATION_TTL_MS` | `86400000` | Validade das evidências: 24 horas |

API, worker e CLI usam o mesmo `PDF_DIR` e `DATABASE_PATH`. A configuração é lida ao iniciar o processo; reinicie os processos depois de alterar o ambiente. Valores inteiros, faixa da porta, limiar de similaridade, sobreposição e protocolos HTTP são validados.

O orçamento do histórico é uma estimativa por caracteres, não uma contagem exata do tokenizer. Alterar modelo ou dimensão dos embeddings exige compatibilidade da coleção e reindexação dos documentos; vetores de modelos diferentes não devem ser misturados.

O modo solicitado para a intranet mantém token e CORS vazios. Não há autenticação obrigatória nem jurisdição municipal automática. Se houver um proxy, ajuste `TRUST_PROXY_HOPS` à topologia real para que o limite por IP funcione corretamente.

No Compose da aplicação, os caminhos usam `/app/data`. `PORT` controla também o mapeamento HTTP; `QDRANT_DOCKER_URL` e `OLLAMA_DOCKER_URL` substituem os endpoints internos. `NODE_IMAGE`, `QDRANT_IMAGE` e `OLLAMA_IMAGE` substituem as imagens reproduzíveis do exemplo. Para serviços externos, a API e o worker também podem rodar diretamente com as URLs do ambiente.

Migração: ambientes antigos precisam declarar `LLM_BASE_URL` (ou `GROQ_BASE_URL`) e `EMBEDDING_MODEL`. O exemplo Groq está em `.env.example`; nenhum endpoint Groq é escolhido pelo código. Normalização e geração compartilham um único cliente. A API e a ingestão podem iniciar sem credencial de chat; ela é exigida ao usar a IA.

A versão de ingestão inclui modelo, dimensão, contexto e parâmetros do chunker. Alterá-los invalida o reaproveitamento da versão anterior na próxima ingestão. Para trocar o modelo de embeddings, use uma coleção nova e reingira todos os documentos antes das consultas.
