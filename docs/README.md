# Documentação do RAG VISA

## Organização

| Página | Quando consultar |
| --- | --- |
| [Desenvolvimento](development.md) | Usar Ponytail, consultar Graphify e atualizar dependências |
| [Arquitetura](architecture.md) | Entender componentes, ingestão, busca e armazenamento |
| [API](api.md) | Integrar cadastro, barra de progresso e chat no frontend |
| [Configuração](configuration.md) | Preparar variáveis de ambiente e limites |
| [Operação](operations.md) | Executar workers, usar Docker, investigar falhas e fazer backup |
| [Testes e avaliação](testing.md) | Validar alterações e interpretar os resultados do RAG |

Para instalar e fazer a primeira consulta, consulte o [README principal](../readMe.md).

## Forma de documentação adotada

Usamos Markdown no próprio repositório: alterações de comportamento e de documentação podem ser revisadas juntas no mesmo commit ou PR. Essa abordagem atende ao tamanho atual do sistema, funciona sem serviço externo e dispensa uma etapa de build ou publicação.

O README apresenta instalação e uso inicial. As páginas deste diretório detalham os contratos e a operação. Diagramas usam Mermaid, renderizado por ferramentas compatíveis com Markdown.

Ao alterar uma rota, variável, estado de ingestão ou procedimento operacional, atualize a página correspondente e seus exemplos. O código é a referência da implementação; esta documentação descreve o comportamento disponível, sem tratar planos futuros como funcionalidades prontas. Não registre chaves, dados pessoais ou conteúdo real de conversas nos exemplos.

Se houver necessidade de documentação pública navegável ou geração de clientes, o conteúdo pode ser aproveitado posteriormente em um site e o contrato HTTP pode ser formalizado em OpenAPI.
