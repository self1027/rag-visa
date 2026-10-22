# Testes e avaliação do RAG

## Validação de alterações

```bash
npm ci
npm run typecheck
npm test
```

Os testes unitários e de integração usam dependências externas simuladas. O teste com serviços reais fica desabilitado na suíte padrão. A [integração contínua](../.github/workflows/checks.yml) executa instalação, verificação de tipos e testes; ela não executa a avaliação com endpoint de IA configurado nem a ingestão real.

Com Qdrant, Ollama e `bge-m3` disponíveis:

```bash
npm run test:live
```

O teste real usa uma coleção e armazenamento temporários, executa workers em processos separados e verifica recuperação após interrupção de um deles. Remove os recursos próprios ao finalizar. Não faz chamadas ao endpoint de IA configurado; sua duração depende do desempenho local do modelo.

## Avaliação da recuperação

O conjunto em [cases.json](../src/evaluation/cases.json) contém perguntas com fontes esperadas e um caso negativo. Execute com a coleção já populada pelo acervo correspondente:

```bash
npm run eval:rag -- --grid
```

O comando compara os pares de limite/limiar `(3, 0.3)`, `(6, 0.3)` e `(6, 0.5)`, consulta Ollama e Qdrant e grava `reports/rag-evaluation.json`. Não indexa documentos. O relatório é sobrescrito a cada execução. Os relatórios são artefatos locais ignorados pelo Git e podem conter respostas e trechos do acervo.

Métricas incluem presença das fontes esperadas entre os primeiros resultados, posição do primeiro resultado relevante, precisão, abstenção no caso sem evidência e latência. Compare resultados usando o mesmo acervo e modelo.

## Avaliação da geração

```bash
npm run eval:rag -- --generate
```

Esse modo também chama o endpoint de IA configurado e consome sua cota. Grava `reports/rag-generation.json` com respostas e verificações de citação, cobertura de termos e recusa quando não há evidência. A implementação está em [run.ts](../src/evaluation/run.ts) e [metrics.ts](../src/evaluation/metrics.ts).

A validade de uma citação numérica verifica se seu identificador corresponde a uma fonte recuperada; não verifica se o trecho sustenta juridicamente a afirmação. Ausência de citações numéricas deve ser analisada separadamente. Relatórios de execuções anteriores podem não conter campos adicionados posteriormente ao avaliador.

## Interpretação e evolução

O conjunto inicial tem cinco casos positivos e um negativo, com perguntas próximas às fontes conhecidas. Os relatórios gerados são registros de execução, não uma garantia de desempenho em todo o domínio. A avaliação inicial recuperou as fontes esperadas, mas também identificou resposta sem o formato de citação numérica esperado.

Amplie o conjunto com perguntas reais, paráfrases, normas concorrentes, jurisdições diferentes, documentos revogados, perguntas sem resposta no acervo e acompanhamentos de conversa. Revise as respostas com especialistas para avaliar correção, vigência e sustentação das afirmações. Mantenha casos e expectativas versionados para detectar regressões.
