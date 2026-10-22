# Teste do embeddinggemma-pt-br no Ollama

Para executar o modelo diretamente em Python, junto do BERTimbau, consulte [Modelos locais fora do Ollama](local-models.md).

Resultado em 22/10/2026: **bloqueado por incompatibilidade de importação e tokenizer**. O modelo solicitado ainda não está instalado no Ollama. A configuração da aplicação e a coleção existente não foram alteradas por este teste.

## Ambiente e fontes

- Ollama `0.34.3`, executado pelo serviço `ollama` do `docker-compose.yml`, com a imagem e o volume persistente já definidos no projeto.
- Modelo: [tardellirs/embeddinggemma-pt-br](https://huggingface.co/tardellirs/embeddinggemma-pt-br), revisão `e7d1031ee97db28c3e6f87d309cca552e1481622`.
- Conversor llama.cpp: revisão `36cbf415f1c72c199e956c00fed0418f22ca53f2`, Python `3.12.15`, PyTorch `2.11.0+cpu`, Transformers `4.57.6`.
- Pesos, ferramentas e log locais ficam em `data/models/`, fora do versionamento. O conversor foi executado no host; o servidor de inferência permaneceu no container.

O repositório do modelo publica Safetensors, incluindo as projeções `2_Dense` e `3_Dense`, sem GGUF. Sua configuração declara `Gemma3TextModel`, 768 dimensões e contexto de 2048 tokens. A documentação de [importação do Ollama](https://docs.ollama.com/import) descreve a importação de Safetensors e GGUF, mas a importação direta deste modelo falhou na versão testada.

## Testes executados

Com os arquivos da revisão acima em `data/models/embeddinggemma-pt-br`, incluindo um `Modelfile` contendo `FROM .`:

```bash
docker compose cp data/models/embeddinggemma-pt-br/. ollama:/tmp/embeddinggemma-pt-br/
docker compose exec -T ollama ollama create embeddinggemma-pt-br \
  -f /tmp/embeddinggemma-pt-br/Modelfile
```

Resultado: `Error: unsupported MLX architecture: model "Gemma3TextModel"`.

A segunda tentativa usou o conversor do llama.cpp, preservando ambas as projeções Dense:

```bash
data/models/converter-venv/bin/python data/models/llama.cpp/convert_hf_to_gguf.py \
  data/models/embeddinggemma-pt-br \
  --outfile data/models/embeddinggemma-pt-br/embeddinggemma-pt-br-f16.gguf \
  --outtype f16 --sentence-transformers-dense-modules
```

Com os arquivos originais, o conversor falhou na verificação de IDs do tokenizer: `assert max(tokenizer.vocab.values()) < vocab_size`.

Em uma tentativa local, o `added_tokens_decoder` foi alinhado aos IDs de `tokenizer.json` e as referências a tokens de imagem ausentes foram removidas de `tokenizer_config.json`. Isso permitiu avançar até o erro: `NotImplementedError: BPE pre-tokenizer was not recognized - update get_vocab_base_pre()`. O arquivo original foi restaurado depois do diagnóstico. O log dessa última tentativa está em `data/models/embeddinggemma-convert.log`.

Não foi gerado um GGUF utilizável nem executado um teste de embeddings. Forçar um tokenizer diferente pode alterar os IDs e invalidar a comparação com o modelo publicado.

## Condições para usar na aplicação

É necessário obter uma conversão GGUF que preserve o tokenizer reduzido e as projeções Dense, validada contra a execução de referência do modelo. Depois da importação, verificar `/api/embed`, 768 componentes finitos, normalização e similaridade em português antes de reindexar o acervo.

Somente depois dessa validação, configurar no ambiente:

```dotenv
EMBEDDING_MODEL=embeddinggemma-pt-br
EMBEDDING_DIMENSIONS=768
EMBEDDING_CONTEXT_TOKENS=2048
QDRANT_COLLECTION=legislacao_visa_embeddinggemma_pt_br
```

O nome em `EMBEDDING_MODEL` deve corresponder ao modelo efetivamente criado no Ollama. Use uma coleção nova e reingira os documentos; reinicie API e workers para carregar o ambiente. Para recuperação, o autor recomenda `task: search result | query: ` nas consultas e `title: none | text: ` nos documentos. Esses prefixos não foram implementados neste teste.
