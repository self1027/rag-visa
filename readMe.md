# RAG VISA

API para consultar normas de vigilância sanitária a partir de PDFs cadastrados. O sistema extrai o texto, gera embeddings, busca trechos relevantes e transmite respostas com referências para o documento e a página, quando identificada.

O projeto inclui cadastro de documentos, ingestão assíncrona com progresso, chat por SSE e avaliação da recuperação. O frontend deve ser implementado separadamente.

## Tecnologias

- Node.js 24, TypeScript e Express 5.
- SQLite e Drizzle para metadados, fila de ingestão e evidências das conversas.
- Qdrant para busca vetorial e Ollama com `bge-m3` para embeddings locais.
- Groq para normalização das perguntas e geração das respostas.

Os PDFs e embeddings ficam na infraestrutura local. O histórico enviado ao chat e os trechos usados na resposta são enviados à Groq.

## Executar localmente

Requisitos: Node.js 24, npm, Docker com Compose e uma chave da Groq.

```bash
npm ci
cp .env.example .env
```

Preencha `GROQ_API_KEY` no `.env`. Em seguida:

```bash
docker compose up -d
docker compose exec ollama ollama pull bge-m3
npm run dev:server
```

A API atende em `http://localhost:3333`. Por padrão, o worker de ingestão roda junto com a API.

```bash
curl http://localhost:3333/api/health
curl http://localhost:3333/api/ready
```

`health` verifica se a API está respondendo; `ready` verifica Qdrant e a disponibilidade do modelo no Ollama. A chave e o acesso à Groq precisam funcionar para o chat.

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
