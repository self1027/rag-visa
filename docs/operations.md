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

Os serviços Qdrant e Ollama estão definidos em [docker-compose.yml](../docker-compose.yml), com imagens fixadas por versão e digest. O [Dockerfile](../Dockerfile) executa a aplicação com Node.js 24 e usuário sem privilégios.

Com `.env` preenchido e o diretório `data` gravável pelo usuário do container (UID 1000):

```bash
docker compose up -d
docker compose exec ollama ollama pull bge-m3
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build --scale worker=2
```

O [arquivo complementar](../docker-compose.app.yml) separa API e workers, compartilhando `./data`. `depends_on` controla a ordem de inicialização, sem garantir prontidão dos serviços. Consulte `/api/ready` depois de subir a aplicação.

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml logs --tail=100 api worker
```

## Diagnóstico

| Sintoma | Verificação |
| --- | --- |
| `/api/ready` retorna `503` | Conferir Qdrant, Ollama, URLs e presença do modelo em `ollama list` |
| Chat falha com serviços locais prontos | Conferir chave, disponibilidade do modelo e conexão com o endpoint de IA configurado |
| Documento permanece `queued` | Confirmar worker ativo e acesso ao mesmo SQLite e diretório de PDFs |
| Documento ficou `processing` após uma queda | Aguardar expiração da concessão; worker ativo recupera a tarefa |
| Ingestão `failed` | Consultar `ingestion.error`, logs, camada de texto do PDF e serviços; tentar novamente pela API |
| Upload retorna `409` | Verificar nome já presente no banco ou no diretório de PDFs |
| Busca não encontra documento | Conferir conclusão, vigência, filtros, metadados e limiar de similaridade |
| Erro de permissão em Docker | Conferir permissões de `data` para UID 1000 |

`GET /api/health` mede apenas a resposta da API. `GET /api/ready` verifica Qdrant e o modelo no Ollama; não valido endpoint de IA configurado nem compatibilidade de dimensões. `GET /api/metrics` expõe contagem de requisições, erros HTTP 5xx, duração acumulada e jobs por estado. Métricas HTTP são locais ao processo e reiniciam com ele; o endpoint não usa formato Prometheus.

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
