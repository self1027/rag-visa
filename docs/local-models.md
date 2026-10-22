# Modelos locais fora do Ollama

Ambiente isolado em `data/models/python-env`, com Python 3.12 e PyTorch para CPU. Os pesos ficam em `data/models/`, fora do Git. EmbeddingGemma e BERTimbau estão integrados ao RAG pelo serviço HTTP Python; BERTimbau é uma alternativa experimental com média dos tokens. BGE-M3 usa o Ollama.

## Escolher pela interface

Em `/`, no painel **Recuperação e resposta**, selecione **Modelo de embeddings** e clique em **Aplicar e reindexar PDFs**. Estão configurados EmbeddingGemma PT-BR, BERTimbau Base e BGE-M3. A escolha vale para API, workers, chat CLI e avaliação; fica salva na tabela `embedding_selection` do SQLite, sem reiniciar processos.

A escolha é validada com uma geração real antes de ser salva. Se o serviço falhar ou não tiver memória, a seleção anterior permanece. Os documentos entram na fila automaticamente, e o progresso aparece na listagem. Tarefas que já começaram mantêm o modelo anterior até terminar e depois reindexam no novo. Enquanto a reindexação avança, só os documentos publicados na coleção escolhida ficam disponíveis; uma coleção já existente pode continuar servindo versões anteriores até sua substituição.

Cada perfil tem coleção própria. Remover um PDF limpa seus vetores em todas as coleções configuradas, para que ele não reapareça ao voltar a outro embedder. BERTimbau usa contexto de 512 tokens, trechos de 900 caracteres e sobreposição de 120; EmbeddingGemma mantém contexto de 2048 tokens. O pooling do BERTimbau não foi ajustado para busca semântica, portanto compare a qualidade antes de adotá-lo.

`EMBEDDING_PROFILES` contém os perfis adicionais permitidos pelo servidor; o padrão tem ID `default` e usa `EMBEDDING_*`, `QDRANT_COLLECTION`, `CHUNK_MAX_LENGTH` e `CHUNK_OVERLAP`. `EMBEDDING_LABEL` define seu nome no seletor. Cada perfil adicional declara `id`, `label`, `embeddingProvider`, `embeddingUrl`, `embeddingModel`, `embeddingRevision`, `embeddingDimensions`, `embeddingContextTokens`, `embeddingQueryPrefix`, `embeddingDocumentPrefix`, `collection`, `chunkMaxLength` e `chunkOverlap`. IDs e coleções devem ser exclusivos. A interface aceita somente o ID; não permite cadastrar URLs ou caminhos arbitrários. No Compose da aplicação, `EMBEDDING_DOCKER_PROFILES` substitui as URLs para usar a rede interna.

O serviço Python usa `EMBEDDING_MODELS` para os modelos locais adicionais, com `model`, `revision`, `path`, `pooling` (`mean` ou `sentence-transformers`), `dimensions` e `contextTokens`. Os caminhos são internos ao container; `BERTIMBAU_MODEL_PATH` altera a pasta do host montada para BERTimbau. O serviço mantém apenas um modelo Python carregado por vez e faz a troca sob o mesmo bloqueio de inferência. `/health?model=...` informa a configuração de um modelo disponível; o seletor valida seu carregamento pela geração de teste. O primeiro uso após uma troca pode demorar mais.

## EmbeddingGemma integrado ao RAG

O `.env.example` usa este perfil. O `.env` local foi configurado com os mesmos parâmetros, preservando as credenciais de chat:

```dotenv
EMBEDDING_PROVIDER=sentence-transformers
EMBEDDING_URL=http://localhost:8001
EMBEDDING_MODEL=tardellirs/embeddinggemma-pt-br
EMBEDDING_REVISION=e7d1031ee97db28c3e6f87d309cca552e1481622
EMBEDDING_MODEL_PATH=./data/models/embeddinggemma-pt-br
EMBEDDING_DIMENSIONS=768
EMBEDDING_CONTEXT_TOKENS=2048
EMBEDDING_QUERY_PREFIX="task: search result | query: "
EMBEDDING_DOCUMENT_PREFIX="title: none | text: "
QDRANT_COLLECTION=legislacao_visa_embeddinggemma_pt_br
COMPOSE_PROFILES=embeddinggemma
```

Depois de obter os pesos pelos comandos de reinstalação abaixo:

```bash
docker compose up -d --build embeddings qdrant
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build api worker
curl http://localhost:3333/api/ready
```

O `Dockerfile.embeddings` fixa a imagem Python e os pacotes de `requirements-local-models.txt`, executa como UID 1000 e monta os pesos somente para leitura. O carregamento funciona offline. O perfil `embeddinggemma` habilita o serviço e API/worker aguardam seu healthcheck. Sua porta é publicada apenas em `127.0.0.1`; é um serviço interno sem autenticação, não um endpoint público. A inferência é serializada para limitar uso de memória e o healthcheck continua responsivo durante a geração. Baixe ambos os modelos Python pelos comandos abaixo antes de usar o Compose do exemplo.

Para usar Node no host, execute `npm run dev:server` após subir `embeddings` e `qdrant`. Em containers, o Compose usa `http://embeddings:8001`; `EMBEDDING_DOCKER_URL` pode substituir esse endereço. `EMBEDDING_PORT`, `EMBEDDING_MAX_BODY_BYTES`, `LOCAL_MODEL_THREADS` e `REQUEST_TIMEOUT_MS` controlam porta, limite do corpo, threads e espera. `PYTHON_IMAGE` substitui a imagem base do serviço.

O cliente Node aplica os prefixos uma única vez, conforme a tarefa, e o serviço verifica o comprimento já com o prefixo e os tokens especiais. `POST /api/embed` recebe `{ "model": "...", "input": "...", "contextTokens": 2048 }` e retorna `{ "model": "...", "embeddings": [[...]] }`. Contexto excedido retorna `422` com `code: context_exceeded`; entradas inválidas retornam `400`, modelo divergente `404` e corpo excessivo `413`. Erros não incluem o texto dos documentos. O cliente mantém timeout e cancelamento HTTP; uma inferência de CPU já iniciada pode terminar depois que o cliente cancela.

`GET /health` do serviço informa modelo, revisão, dimensão e contexto. `/api/ready` verifica a compatibilidade desses campos com o ambiente da aplicação. A identidade do modelo e da revisão é declarada pelo ambiente; use os pesos da revisão fixada na reinstalação.

Reprocesse os documentos pela interface ou por `POST /api/documents/:filename/ingest`. Para um acervo sem jobs ativos, `npm run ingest` reindexa todos os PDFs cadastrados. A versão de ingestão inclui provedor, revisão e prefixos, além do modelo e dos parâmetros anteriores. A coleção antiga fica preservada; a nova coleção precisa ser preenchida antes de oferecer as consultas do acervo.

Para voltar ao Ollama, use `EMBEDDING_PROVIDER=ollama`, modelo/contexto/dimensões e coleção correspondentes aos vetores anteriores, esvazie os prefixos e `EMBEDDING_REVISION`, remova `COMPOSE_PROFILES=embeddinggemma` e reinicie API e worker. Para `bge-m3`, os valores anteriores eram contexto `8192`, dimensão `1024` e coleção `legislacao_visa`.

## Executar

Na raiz do projeto:

```bash
data/models/python-env/bin/python scripts/test-local-models.py
```

Para testar seus próprios textos:

```bash
data/models/python-env/bin/python scripts/test-local-models.py \
  'Quais são as regras sanitárias para restaurantes?' \
  'Restaurantes precisam seguir normas de higiene.' \
  'Júpiter é um planeta do sistema solar.'
```

O comando funciona offline, valida componentes finitos e normalização e imprime a matriz de similaridade por cosseno. `LOCAL_MODELS_DIR` altera a pasta dos pesos e `LOCAL_MODEL_THREADS` controla as threads de CPU (padrão: 2). Textos acima do contexto são rejeitados, sem truncamento silencioso.

- [tardellirs/embeddinggemma-pt-br](https://huggingface.co/tardellirs/embeddinggemma-pt-br): revisão `e7d1031ee97db28c3e6f87d309cca552e1481622`, carregado por Sentence Transformers com suas projeções Dense. O teste compara frases sem prompt de tarefa. Para recuperação, o autor recomenda prefixos distintos: `task: search result | query: ` e `title: none | text: `.
- [neuralmind/bert-base-portuguese-cased](https://huggingface.co/neuralmind/bert-base-portuguese-cased): revisão `94d69c95f98f7d5b2a8700c420230ae10def0baa`, carregado por Transformers. O teste usa média dos tokens, excluindo padding e tokens especiais, seguida de normalização. É um BERT pré-treinado; esse pooling experimental não equivale a um modelo ajustado para recuperação semântica.

Ambos produzem 768 componentes neste teste, mas seus espaços vetoriais são diferentes. Não misture seus vetores numa coleção nem use os scores deste exemplo como avaliação de qualidade do RAG. Nenhuma reindexação do acervo é executada.

## Reinstalar

Requer [uv](https://docs.astral.sh/uv/) e acesso à internet para baixar os pacotes e pesos:

```bash
uv venv --python 3.12 data/models/python-env
uv pip sync --python data/models/python-env/bin/python requirements-local-models.txt \
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
```

Para baixar somente os arquivos necessários nas revisões testadas:

```bash
data/models/python-env/bin/python - <<'PY'
import os
from pathlib import Path
from huggingface_hub import snapshot_download

root = Path(os.environ.get('LOCAL_MODELS_DIR', 'data/models'))
for repo, revision, folder in [
    ('tardellirs/embeddinggemma-pt-br', 'e7d1031ee97db28c3e6f87d309cca552e1481622', 'embeddinggemma-pt-br'),
    ('neuralmind/bert-base-portuguese-cased', '94d69c95f98f7d5b2a8700c420230ae10def0baa', 'bert-base-portuguese-cased'),
]:
    snapshot_download(repo, revision=revision, local_dir=root / folder,
                      allow_patterns=['*.json', '*.safetensors', 'pytorch_model.bin', 'vocab.txt'])
PY
```

Os arquivos originais do EmbeddingGemma foram preservados, incluindo `tokenizer_config.json`; não é necessária a conversão GGUF tentada no [teste do Ollama](embeddinggemma-pt-br.md).
