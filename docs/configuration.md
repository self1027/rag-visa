# Configuração

Copie [`.env.example`](../.env.example) para `.env` e preencha a chave da Groq. A configuração central fica em [settings.ts](../src/config/settings.ts); caminhos de persistência e flags também são lidos nos respectivos componentes.

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `GROQ_API_KEY` | Obrigatória para o chat | Credencial de acesso à Groq |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Modelo para normalização e geração |
| `PORT` | `3333` | Porta HTTP |
| `TRUST_PROXY_HOPS` | `0` | Quantidade de proxies confiáveis para identificação do IP |
| `QDRANT_URL` | `http://localhost:6333` | Endpoint do Qdrant |
| `QDRANT_COLLECTION` | `legislacao_visa` | Coleção vetorial |
| `OLLAMA_URL` | `http://localhost:11434` | Endpoint do Ollama |
| `EMBEDDING_MODEL` | `bge-m3` | Modelo de embeddings |
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

O CLI `npm run ingest` usa `data/pdfs` por padrão; não herda a configuração `PDF_DIR` da API. Use nomes e caminhos consistentes ao alternar entre modos de execução.

O orçamento do histórico é uma estimativa por caracteres, não uma contagem exata do tokenizer. Alterar modelo ou dimensão dos embeddings exige compatibilidade da coleção e reindexação dos documentos; vetores de modelos diferentes não devem ser misturados.

O modo solicitado para a intranet mantém token e CORS vazios. Não há autenticação obrigatória nem jurisdição municipal automática. Se houver um proxy, ajuste `TRUST_PROXY_HOPS` à topologia real para que o limite por IP funcione corretamente.

No Compose da aplicação, URLs e caminhos são sobrescritos para os nomes internos dos serviços e `/app/data`. Alterar a porta no `.env` também exige adequar o mapeamento de portas do Compose.
