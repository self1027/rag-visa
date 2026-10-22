# API e integração com o frontend

URL local padrão: `http://localhost:3333`. Erros HTTP usam `{ "error": "mensagem" }`. Para nomes de arquivo no caminho, use `encodeURIComponent(filename)`.

O acesso é aberto quando `ADMIN_API_TOKEN` está vazio. Se configurado, envie `Authorization: Bearer <token>` nas operações de escrita, reingestão, métricas e leitura das configurações. Listagem, leitura de PDFs e chat continuam públicos. CORS permite qualquer origem quando `CORS_ORIGINS` está vazio.

## Rotas

| Método | Rota | Resultado de sucesso |
| --- | --- | --- |
| GET | `/api/settings` | `200`, parâmetros atuais, modelos e limites aceitos |
| PUT | `/api/settings` | `200`, parâmetros salvos no SQLite |
| GET | `/api/embedders` | `200`, modelo selecionado e opções configuradas |
| PUT | `/api/embedders` | `200`, escolha persistida e PDFs enfileirados para reindexação |
| GET | `/api/documents` | `200`, documentos e estados de ingestão |
| GET | `/api/documents/:filename` | `200`, PDF servido inline |
| POST | `/api/documents` | `201`, cadastro e ingestão enfileirada |
| PUT | `/api/documents/:filename` | `200`, atualização e reindexação enfileirada |
| DELETE | `/api/documents/:filename` | `200`, exclusão de vetores, cadastro e PDF |
| POST | `/api/documents/:filename/ingest` | `202`, nova tentativa enfileirada |
| POST | `/api/chat` | `200`, fluxo SSE |
| GET | `/api/health` | `200`, `{ "status": "ok" }` |
| GET | `/api/ready` | `200` quando pronto; `503` quando indisponível |
| GET | `/api/metrics` | `200`, métricas HTTP e contagem de jobs |

## Configuração da recuperação e da resposta

O seletor **Modelo de embeddings** usa `GET /api/embedders`, que retorna `selectedId` e `profiles` com `id`, `label`, `model`, `provider`, `dimensions` e `contextTokens`. Não retorna URLs, caminhos ou credenciais. Para trocar, envie `PUT /api/embedders` com apenas `{ "id": "bertimbau" }`. As duas rotas seguem `ADMIN_API_TOKEN`.

A troca testa a geração no modelo de destino, prepara sua coleção, salva a escolha no SQLite e enfileira os documentos. Retorna também `changed`; escolher o modelo já ativo não inicia nova reindexação. IDs desconhecidos, campos extras e modelos indisponíveis retornam `400` sem alterar a seleção. Exclusão em andamento retorna `409`. Cada requisição e tarefa usa um snapshot do modelo e da coleção; tarefas iniciadas no modelo anterior terminam nele e voltam à fila para o modelo selecionado. `GET /api/documents` inclui `embedderId` para sincronizar outras páginas abertas.

`GET /api/ready` retorna `status`, `qdrant`, `embeddings` e `embeddingProvider`. Para `ollama`, mantém também o campo `ollama`. Para `sentence-transformers`, a prontidão exige modelo, dimensão, contexto e revisão compatíveis no serviço Python. Prontidão não garante que todos os documentos estejam indexados na coleção configurada.

A página estática em `/` consulta e altera esses parâmetros via `fetch`. Não utiliza EJS e pode ser hospedada separadamente: configure a origem da API em “Conectar à API” e permita a origem da página em `CORS_ORIGINS`, quando restrito. A origem fica no navegador; o token administrativo permanece apenas na memória da página e precisa ser informado novamente ao recarregar.

`GET /api/settings` retorna `searchLimit`, `searchThreshold`, `maxResponseTokens`, `model`, `embeddingModel`, `uploadMaxBytes` e `limits`. Nenhuma credencial ou endpoint de inferência é retornado. Quando `ADMIN_API_TOKEN` está configurado, GET e PUT exigem Bearer.

Envie os três parâmetros numéricos com `PUT /api/settings`:

```json
{ "searchLimit": 6, "searchThreshold": 0.3, "maxResponseTokens": 1000 }
```

`searchLimit` aceita inteiros de 1 a 50; `searchThreshold` aceita valores de 0 a 1; `maxResponseTokens` aceita inteiros de 1 a 32000. Campos adicionais, ausentes ou tipos inválidos retornam `400`. O máximo de tokens ainda precisa ser compatível com o modelo escolhido no servidor.

Os ajustes persistem na tabela `rag_settings` do SQLite e valem para as próximas perguntas, inclusive em outras instâncias que compartilhem o banco. Sem um registro salvo, usam-se os padrões do ambiente. Os valores persistidos têm precedência sobre esses três padrões até serem alterados novamente pela API. Modelos, endpoints e credenciais continuam configurados no servidor. A relevância mínima mede similaridade vetorial, não a confiança jurídica da resposta.

## Cadastro e atualização

Envie `multipart/form-data`. No POST, `file`, `titulo`, `esfera`, `tipo`, `ano` e `orgao` são obrigatórios. No PUT, arquivo e metadados são opcionais; os campos enviados substituem seus valores e enfileiram reindexação.

| Campo | Regra |
| --- | --- |
| `file` | Um arquivo `.pdf`, MIME `application/pdf`, assinatura PDF válida; máximo padrão de 25 MiB |
| `titulo` | Texto não vazio, até 500 caracteres |
| `esfera` | `federal`, `estadual` ou `municipal` |
| `tipo` | Texto não vazio, até 100 caracteres; por exemplo, `legislacao` |
| `ano` | Inteiro de 1 a 9999 |
| `orgao` | Texto não vazio, até 200 caracteres |
| `jurisdicao` | Opcional, até 120 caracteres; padronize os valores usados nos filtros |
| `urlOficial` | Opcional, começando por `http://` ou `https://` |
| `vigencia` | `vigente`, `revogada` ou `desconhecida`; padrão `desconhecida` |
| `versao` | Opcional, até 120 caracteres |

POST e PUT retornam `{ "message": "...", "filename": "norma.pdf", "metadata": { ... } }`; `metadata` inclui o estado `ingestion`. O sucesso confirma o enfileiramento, não a conclusão da indexação.

O cadastro retorna `409` se o nome já existir no banco ou no armazenamento. Atualização, exclusão e reingestão retornam `409` enquanto o documento estiver ocupado. Documento ausente retorna `404`; entrada inválida retorna `400`. Uma falha de exclusão preserva o cadastro e o PDF para nova tentativa.

## Listagem e barra de progresso

`GET /api/documents` retorna este formato ilustrativo:

```json
{
  "total": 1,
  "documents": [{
    "filename": "norma.pdf",
    "titulo": "Norma de exemplo",
    "esfera": "federal",
    "tipo": "legislacao",
    "ano": 2024,
    "orgao": "Órgão responsável",
    "jurisdicao": null,
    "urlOficial": null,
    "vigencia": "desconhecida",
    "versao": null,
    "ingestion": {
      "status": "processing",
      "phase": "embedding",
      "progress": 45,
      "totalChunks": 100,
      "embeddedChunks": 50,
      "indexedChunks": 0,
      "error": null,
      "updatedAt": "2026-10-13T12:00:00.000Z"
    }
  }]
}
```

| `status` | Tratamento sugerido no frontend |
| --- | --- |
| `pending` | Documento sem ingestão iniciada |
| `queued` | Exibir “Na fila” |
| `processing` | Mostrar percentual e etapa |
| `completed` | Mostrar conclusão |
| `failed` | Exibir `error` e oferecer nova tentativa |
| `deleting` | Mostrar exclusão em andamento e bloquear edição |

Etapas de ingestão: `queued`, `extracting`, `chunking`, `embedding`, `indexing`, `publishing`, `completed` ou `failed`; documentos sem execução têm `pending`. Durante exclusão, a etapa pode manter seu último valor.

`progress` é um percentual de trabalho ponderado, não uma estimativa de tempo restante. A extração começa em 2%, a divisão em 5%, embeddings e indexação avançam até 95%, a publicação chega a 97% e a conclusão a 100%. O percentual reinicia em uma nova tentativa. Contadores são atualizados ao longo da execução; `updatedAt` pode ser `null` antes de existir um job.

Sugestão de integração: consultar a listagem a cada 1–2 segundos enquanto houver jobs `queued`, `processing` ou `deleting`. Use `filename` como chave estável, `progress` no valor da barra e `status` para decidir conclusão ou erro. Após um upload, atualize imediatamente a listagem. Interrompa o polling ao sair da tela e trate falhas de rede.

Para tentar novamente:

```bash
curl -X POST http://localhost:3333/api/documents/norma.pdf/ingest
```

A resposta é `{ "filename": "norma.pdf", "ingestion": { ... } }`.

## Chat com SSE

Corpo JSON:

```json
{
  "history": [{ "role": "user", "content": "Quais regras se aplicam ao armazenamento de alimentos?" }],
  "jurisdicao": "Município/UF",
  "esfera": "municipal",
  "preferMunicipal": true
}
```

Somente `history` é obrigatório. Deve ser uma lista não vazia com mensagens `user` ou `assistant`, conteúdo não vazio e última mensagem do usuário. O histórico antigo é cortado conforme o orçamento configurado; uma última mensagem acima do limite é rejeitada. Os campos `jurisdicao`, `esfera`, `preferMunicipal` e `conversationId` são opcionais. Não há município padrão.

A preferência municipal depende de jurisdição informada e não se aplica a um filtro explícito federal ou estadual. O filtro de jurisdição também permite recuperar normas federais e estaduais pertinentes; a esfera restringe adicionalmente o resultado.

A resposta inclui `Content-Type: text/event-stream`, `X-Conversation-Id` e eventos separados por linha em branco:

```text
data: {"type":"chunk","content":"Texto parcial da resposta"}

data: {"type":"sources","sources":[],"normalizedQuery":"consulta normalizada","conversationId":"UUID"}

data: [DONE]

```

Cada fonte pode conter `artigo`, `score`, `fonte`, `filename`, `pagina`, `paginaFim`, `urlOficial`, `jurisdicao`, `vigencia`, `versao` e `pdfUrl`. Campos sem informação podem estar ausentes. `pdfUrl` aponta para `/api/documents/arquivo.pdf#page=N` quando há página identificada. Resolva essa URL relativa contra a origem da API, se o frontend estiver em outra origem.

O cliente deve usar `fetch` com POST e ler `response.body`: `EventSource` nativo usa GET. Decodifique incrementalmente com `TextDecoder`, acumule um buffer e processe eventos completos separados por `\n\n`; um bloco recebido pode conter parte de um evento ou vários eventos.

Concatene `chunk.content`, armazene as fontes e o `conversationId` do evento `sources` e finalize em `[DONE]`. Um evento `{ "type": "error", "message": "..." }` encerra o fluxo com falha, sem garantir `[DONE]`. Antes de ler o stream, verifique `response.ok`, pois erros de validação são JSON.

Envie o `conversationId` nas próximas mensagens e continue enviando o histórico: o servidor persiste evidências, não a conversa completa. IDs inválidos retornam `400`; conversas ausentes ou expiradas retornam `404`. Nesse caso, o cliente pode iniciar uma conversa nova sem o ID. O identificador permite acessar as evidências da conversa no modo aberto.

O chat permite cinco requisições por minuto por IP, por instância da API; excesso retorna `429`. O fluxo pode ser cancelado pelo cliente com `AbortController`.
