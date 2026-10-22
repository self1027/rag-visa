# Operação

## API e workers

Para desenvolvimento, `npm run dev:server` executa API e worker juntos por padrão. Para separar os processos, use dois terminais, com o mesmo banco e diretório de PDFs:

```bash
INGESTION_WORKER_IN_API=false npm run start
```

```bash
npm run worker
```

O worker independente processa a fila mesmo que a flag do worker embutido esteja desabilitada. Workers concorrentes precisam compartilhar armazenamento local no mesmo host. SQLite em volume de rede ou hosts distintos não é uma configuração suportada por esta arquitetura.

## Aplicação em Docker

Os serviços Qdrant, Ollama e embeddings Python estão definidos em [docker-compose.yml](../docker-compose.yml), com imagens fixadas por versão e digest. O [Dockerfile](../Dockerfile) executa a aplicação com Node.js 24 e usuário sem privilégios. O [Dockerfile.embeddings](../Dockerfile.embeddings) executa Sentence Transformers para CPU; obtenha os pesos pelo procedimento de [modelos locais](local-models.md).

Com `.env` preenchido e o diretório `data` gravável pelo usuário do container (UID 1000):

```bash
docker compose up -d --build embeddings qdrant
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build --scale worker=2
```

O [arquivo complementar](../docker-compose.app.yml) separa API e workers, compartilhando `./data`. No perfil `embeddinggemma`, API e workers aguardam o healthcheck Python. Qdrant e Ollama usam apenas ordem de inicialização; consulte `/api/ready` depois de subir a aplicação. No perfil Ollama, desabilite `COMPOSE_PROFILES=embeddinggemma`, use `docker compose up -d qdrant ollama` e instale o modelo configurado com `ollama pull`.

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml logs --tail=100 api worker
```

## Diagnóstico

O teste do modelo `tardellirs/embeddinggemma-pt-br` no Ollama containerizado está documentado em [embeddinggemma-pt-br.md](embeddinggemma-pt-br.md), com as revisões e os erros de compatibilidade encontrados.

| Sintoma | Verificação |
| --- | --- |
| `/api/ready` retorna `503` | Conferir Qdrant e o provedor de embeddings; no Python, `/health`, modelo, revisão, dimensões e contexto; no Ollama, `ollama list` |
| Chat falha com serviços locais prontos | Conferir chave, disponibilidade do modelo e conexão com o endpoint de IA configurado |
| Documento permanece `queued` | Confirmar worker ativo e acesso ao mesmo SQLite e diretório de PDFs |
| Documento ficou `processing` após uma queda | Aguardar expiração da concessão; worker ativo recupera a tarefa |
| Ingestão `failed` | Consultar `ingestion.error`, logs, camada de texto do PDF e serviços; tentar novamente pela API |
| Upload retorna `409` | Verificar nome já presente no banco ou no diretório de PDFs |
| Busca não encontra documento | Conferir conclusão, vigência, filtros, metadados e limiar de similaridade |
| Erro de permissão em Docker | Conferir permissões de `data` para UID 1000 |

`GET /api/health` mede apenas a resposta da API. `GET /api/ready` verifica Qdrant e o provedor de embeddings selecionado. No Python, confere modelo, revisão, dimensões e contexto; no Ollama, a presença do modelo. Não verifica o endpoint de chat nem se o acervo foi reindexado na coleção. `GET /api/metrics` expõe contagem de requisições, erros HTTP 5xx, duração acumulada e jobs por estado. Métricas HTTP são locais ao processo e reiniciam com ele; o endpoint não usa formato Prometheus.

A API retorna `X-Request-Id` para correlacionar chamadas com os logs. Há eventos de duração de HTTP, RAG e ingestão. O timeout do chat e a desconexão do cliente interrompem o fluxo; chamadas externas também possuem seus próprios limites de duração.

## Acervo existente

O diretório `data/` é armazenamento local e não é versionado pelo Git. PDFs e banco devem ser provisionados ou restaurados separadamente em cada ambiente. Relatórios gerados em `reports/` também não são versionados.

`npm run ingest` exige que todos os PDFs encontrados em `data/pdfs` já estejam cadastrados no SQLite. Arquivos sem cadastro são reportados como erro; não há script de seed ou endpoint de cadastro de arquivos já armazenados. Planeje o cadastro dos metadados do acervo antes de usar esse comando.

Para novos documentos, prefira upload pela API a partir de um arquivo externo ao armazenamento. Informe a jurisdição, vigência e URL oficial quando conhecidas; não presuma esses valores a partir do nome do arquivo. Mudanças nos metadados pela API enfileiram reindexação.

## Backup e restauração

Faça backup conjunto de:

- SQLite e PDFs em `data`, incluindo caminhos personalizados, quando usados.
- Armazenamento do Qdrant em `qdrant_storage`, ou snapshots consistentes da coleção.
- Configuração necessária para restaurar o ambiente, mantendo credenciais em local protegido.

Para uma cópia simples consistente, pare API, workers e Qdrant antes de copiar os diretórios. SQLite em WAL pode ter arquivos `-wal` e `-shm`; não copie somente o arquivo principal enquanto houver escritores ativos. O volume do Ollama guarda os modelos e pode ser preservado ou recriado por download.

Na restauração, mantenha banco, PDFs e vetores do mesmo ponto de backup. Verifique permissões, configuração, prontidão, listagem e uma consulta conhecida antes de liberar uso. Caso os vetores precisem ser reconstruídos, reingira os documentos cadastrados. Não use `docker compose down -v` como procedimento de backup: ele pode remover volumes nomeados.

## Ollama encerra a conexão durante embeddings (EOF)

`embedding_failed` agora informa `code`, `statusCode`, `model`, `contextTokens` e `inputCharacters`, sem registrar o texto do PDF ou a resposta bruta do serviço. A listagem apresenta uma orientação específica quando o processo interno encerra a conexão, falta o modelo, o contexto é excedido ou a requisição expira. `200` e `304` na consulta periódica de documentos são normais.

Um EOF significa que a conexão com o processo interno foi encerrada; sozinho não prova falta de memória. Confirme os logs e o estado do container (`docker inspect`) e, quando disponível, o contador `oom_kill` em `/sys/fs/cgroup/memory.events`. A documentação oficial do [Ollama](https://docs.ollama.com/troubleshooting) indica onde consultar os logs em cada plataforma.

Em ambientes com cerca de 4 GB para Docker/WSL, o `bge-m3` F16 pode exceder a memória disponível durante a ingestão. Ampliar a memória disponível para 8 GB ou mais é um ponto de partida, sujeito ao acervo e aos demais processos. Como alternativa, use um modelo mais leve ou quantizado em uma coleção nova e reingira os documentos. Dimensões iguais não garantem que modelos diferentes produzam vetores compatíveis.

Reduzir `CHUNK_MAX_LENGTH`, `CHUNK_OVERLAP` e `EMBEDDING_CONTEXT_TOKENS` pode diminuir o consumo, mas aumenta a quantidade de trechos e altera a recuperação. Valide a ingestão completa e os casos de busca antes de adotar esse perfil. A chamada usa `/api/embed` com `truncate: false`: um trecho acima do contexto retorna erro em vez de descartar texto silenciosamente.

Depois de corrigir a infraestrutura ou configurar outro modelo, reinicie API e workers para carregar o ambiente e use **Tentar novamente/Reprocessar** na página, ou `POST /api/documents/:filename/ingest`. Não é necessário remover e cadastrar novamente o PDF. A publicação permanece atômica: uma tentativa que falha não substitui os vetores publicados por uma versão parcial.
