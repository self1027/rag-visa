# Desenvolvimento

A [skill Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md) orienta alterações completas com o mínimo de código: reutilizar funções existentes, eliminar duplicação e preservar validações, segurança e tratamento de erros. Endpoints, credenciais, modelos e parâmetros operacionais pertencem à configuração. Dependências de bibliotecas continuam declaradas em `package.json` e resolvidas em `package-lock.json`.

## Consultar e atualizar o grafo

O [Graphify](https://github.com/Graphify-Labs/graphify) analisa o código local por AST e registra relações e localizações. Ele é uma ferramenta de desenvolvimento; o chat legislativo continua consultando os PDFs cadastrados.

Instale com Python 3.10+ em um ambiente virtual (ou `uv tool install 'graphifyy[watch]>=0.9.93,<0.10'`). O executável `graphify` precisa estar no `PATH`:

```bash
python3 -m venv .tools/venv
.tools/venv/bin/pip install -r .tools/requirements.txt
export PATH="$PWD/.tools/venv/bin:$PATH"
npm run graph:update
npm run graph:query -- 'getLlmClient askRAG'
npm run graph:watch
```

`graph:query` reconstrói o grafo antes de consultar, incluindo remoções e renomeações. `graph:watch` faz uma reconstrução inicial e acompanha mudanças enquanto o comando estiver ativo. As instruções em `AGENTS.md` exigem consulta antes de explorar código e atualização depois de alterações. O CI reconstrói em cada push/PR e publica `graph.json` como artefato associado à revisão.

O modo usado é `--code-only` com `GRAPHIFY_BACKEND=none`: sem extração semântica por IA. `.graphifyignore` exclui segredos, PDFs, bancos e dependências instaladas. Markdown e PDFs não fazem parte desse grafo; consulte a documentação diretamente para contratos e operação. `graphify-out/` é derivado e ignorado pelo Git. Os números de nós e relações mudam com o código; o grafo é um mapa para localizar a implementação, não prova de comportamento.

## Atualizar dependências

O Dependabot propõe atualizações semanais para npm, Docker, GitHub Actions e a ferramenta Python. Os PRs precisam passar pelos checks; não há merge automático. `npm ci` usa o lockfile para reproduzir instalações. Para atualizar Graphify localmente, use `uv tool upgrade graphifyy` ou reinstale `.tools/requirements.txt` com `--upgrade`, depois reconstrua o grafo.

As imagens Docker têm referências reproduzíveis e podem ser substituídas por ambiente. Ao aceitar atualização de uma imagem padrão, alinhe também o exemplo em `.env.example` e o argumento de build no Compose. Trocar provedor de chat requer uma API compatível com OpenAI; trocar a biblioteca de armazenamento exige adaptação do código. Essa limitação é explícita e evita criar uma camada genérica sem implementação alternativa.

## Validar uma alteração

```bash
npm run typecheck
npm test
npm run graph:update
```

Os testes usam credenciais fictícias, mocks dos serviços e um servidor HTTP local para comprovar que o cliente de IA respeita endpoint, modelo e credencial configurados. O teste live depende de Qdrant e Ollama disponíveis. Mudanças de embeddings exigem coleção compatível e reingestão antes do uso.
