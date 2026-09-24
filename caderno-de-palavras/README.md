# Caderno de Palavras

App de uma página para aprender uma palavra de português por dia.

- Publicado em: https://claude.ai/artifact/2EnorbmNDerUBCJ8zmCMhr
- `src/words-*.js`: banco de palavras (44 palavras curadas). O formato está descrito no topo de `src/words-1.js`.
- `src/app.js`: lógica (sugestões diárias às 6h, prova, revisão das últimas 5 palavras, progresso).
- `src/head.html`: título, estilos e estrutura da página.
- `./build.sh`: gera `index.html`, o arquivo que é publicado.

Para acrescentar palavras ao banco fixo, adicione itens em `src/words-*.js`, rode `./build.sh` e republique.
