# RAG VISA

API para consultar normas de vigilância sanitária a partir de PDFs cadastrados. O sistema extrai o texto, gera embeddings, busca trechos relevantes e transmite respostas com referências para o documento e a página, quando identificada.

O projeto inclui cadastro de documentos, ingestão assíncrona com progresso, chat por SSE e avaliação da recuperação. A interface administrativa é HTML, CSS e JavaScript estáticos, servidos pela própria API em `/`, sem EJS nem build.

## Tecnologias

- Node.js 24, TypeScript e Express 5.
- SQLite e Drizzle para metadados, fila de ingestão e evidências das conversas.
- Qdrant para busca vetorial e embeddings locais via Sentence Transformers ou Ollama.
- Endpoint compatível com OpenAI para normalização e geração, configurado por ambiente.

Os PDFs e embeddings ficam na infraestrutura local. O histórico enviado ao chat e os trechos usados na resposta são enviados ao endpoint de IA configurado.

## Executar localmente

Requisitos: Node.js 24, npm, Docker com Compose e acesso a um endpoint de IA compatível com OpenAI.

```bash
npm ci
cp .env.example .env
```

Configure `LLM_BASE_URL`, `LLM_API_KEY` e `LLM_MODEL` no `.env`. O exemplo usa EmbeddingGemma PT-BR em um serviço Python; baixe os pesos conforme [modelos locais](docs/local-models.md#reinstalar). Para manter o exemplo:

```bash
docker compose up -d --build embeddings qdrant
npm run dev:server
```

Abra `http://localhost:3333` para gerenciar PDFs e parâmetros da IA. A API atende no mesmo endereço. Por padrão, o worker de ingestão roda junto com a API.

```bash
curl http://localhost:3333/api/health
curl http://localhost:3333/api/ready
```

`health` verifica se a API está respondendo; `ready` verifica Qdrant e o provedor de embeddings configurado. A credencial e o endpoint de IA precisam funcionar para o chat.

## Cadastrar um PDF

Use um PDF com texto selecionável, fora do diretório de armazenamento do servidor:

```bash
curl -X POST http://localhost:3333/api/documents \
  -F 'file=@/caminho/norma.pdf' \
  -F 'titulo=Norma de exemplo' \
  -F 'esfera=federal' \
  -F 'tipo=legislacao' \
  -F 'ano=2024' \
  -F 'orgao=Órgão responsável'
```

O retorno `201` confirma o cadastro e o enfileiramento. Consulte `GET /api/documents` para acompanhar `ingestion.status`, `ingestion.phase` e `ingestion.progress` de cada documento. O frontend pode usar esse percentual na barra de progresso; `completed` indica conclusão e `failed` exige tratamento de erro.

PDFs colocados diretamente em `data/pdfs` precisam ter metadados cadastrados no SQLite antes de `npm run ingest`. Não existe cadastro automático desses arquivos nem OCR para PDFs digitalizados.

## Consultar o chat

```bash
curl -N http://localhost:3333/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"history":[{"role":"user","content":"Quais normas tratam de boas práticas em serviços de alimentação?"}]}'
```

A resposta usa SSE em uma requisição **POST**: eventos `chunk`, `sources` e o marcador `[DONE]`. O frontend deve ler o fluxo com `fetch`. Veja o contrato completo e os filtros na [documentação da API](docs/api.md).

## Comandos úteis

| Comando | Finalidade |
| --- | --- |
| `npm run start` | Iniciar a API sem recarregamento automático |
| `npm run worker` | Iniciar um worker independente |
| `npm run chat` | Abrir o chat no terminal |
| `npm run ingest` | Ingerir PDFs já cadastrados |
| `npm run typecheck` | Verificar tipos |
| `npm test` | Executar testes automatizados |
| `npm run test:live` | Testar ingestão com Qdrant e Ollama reais |
| `npm run eval:rag -- --grid` | Avaliar configurações de recuperação |

## Documentação do sistema

A documentação é escrita em **Markdown e versionada junto com o código**, sem ferramentas adicionais de publicação. O [índice em `docs/`](docs/README.md) reúne:

- [Arquitetura e fluxo dos dados](docs/architecture.md).
- [API e integração com o frontend](docs/api.md).
- [Configuração por ambiente](docs/configuration.md).
- [Operação, Docker, recuperação e backup](docs/operations.md).
- [Testes e avaliação do RAG](docs/testing.md).

A configuração atual permite acesso aberto na intranet: `ADMIN_API_TOKEN` e `CORS_ORIGINS` vazios. Essas opções podem ser restringidas futuramente. Nenhuma jurisdição municipal é aplicada automaticamente; os filtros são enviados pelo cliente.

As respostas dependem das normas cadastradas. A vigência desconhecida permanece explícita e a qualidade jurídica deve ser revisada com casos representativos antes de usar o sistema como base de decisão.

## Desenvolvimento e mapa do código

Aplicamos a skill [Ponytail](https://github.com/DietrichGebert/ponytail): reutilizar o existente, reduzir duplicação e validar cada mudança. O [Graphify](https://github.com/Graphify-Labs/graphify) é a fonte de consulta das relações entre arquivos. Consulte o [fluxo de manutenção](docs/development.md) para instalar as ferramentas, atualizar e consultar o grafo.
