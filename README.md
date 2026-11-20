# Agentonator

Seus **locais**, **eventos**, **compromissos** e **agenda** num só lugar — feito para a tela do iPhone.

O Agentonator é um *web app instalável* (PWA): você abre uma vez no Safari, toca em
**Compartilhar → Adicionar à Tela de Início**, e ele passa a funcionar como um app. Ele abre em tela cheia,
funciona sem internet e guarda tudo no próprio iPhone.

---

## Instalar no iPhone

1. **Publique o app** (uma única vez) — veja [Publicação](#publicação) abaixo. Você vai ter um endereço como
   `https://prodriguesolm-oss.github.io/Claude/`.
2. No iPhone, abra esse endereço **no Safari**.
3. Toque em **Compartilhar** (quadrado com seta para cima) → **Adicionar à Tela de Início** → **Adicionar**.
4. Abra sempre pelo ícone **Agentonator** na Tela de Início.

> ⚠️ **Importante:** no iOS, os dados do app instalado e os do Safari ficam **separados**. Cadastre tudo pelo
> app instalado (ícone), não pela aba do Safari.

## Publicação

O app é só um conjunto de arquivos estáticos (não tem servidor nem banco de dados na nuvem). Qualquer
hospedagem estática com HTTPS serve. A mais simples é o **GitHub Pages**:

1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em *Build and deployment → Source*, escolha **Deploy from a branch**.
3. Selecione o branch (ex.: `main`, ou o branch deste trabalho) e a pasta **`/ (root)`** → **Save**.
4. Em 1–2 minutos o endereço aparece no topo da página de Pages.

**Repositório privado:** o GitHub Pages em repositório privado exige plano pago (GitHub Pro/Team). Alternativas
gratuitas: tornar o repositório público (o código não contém dados pessoais — seus dados ficam só no iPhone),
ou arrastar a pasta do projeto para o [Netlify Drop](https://app.netlify.com/drop).

---

## O que o app faz

| Aba | Para quê |
|---|---|
| **Agenda** | A principal. Junta horários avulsos, eventos, visitas a locais e compromissos numa linha do tempo do dia (ou lista das próximas 3 semanas). |
| **Locais** | Cadastro de lugares com nome, endereço, foto e classificação (Cultura, Aventura, Bares e restaurantes, Outros). Busca por nome, filtros, ★ favorito, ♥ Date e ✓ visitado direto na lista; data da visita editável. |
| **Eventos** | Eventos sempre ligados a um local cadastrado, com data/hora opcional, classificação, ★ favorito e ♥ Date. Eventos já feitos podem ter a data corrigida sem deixar de estar feitos. |
| **Compromissos** | Lista da sua rotina, agrupada por frequência: **diário**, **semanal**, **mensal** ou **único**. |
| **Favoritos** | Locais e eventos marcados com ★, com filtro por tipo, e o filtro **♥ Date** com todos os locais e eventos marcados como Date. |
| **Histórico** | Tudo que já foi feito, com data e horário. |

### Agenda
- **Cores pela classificação**: Aventura em verde, Cultura em amarelo, Bares e restaurantes em vermelho,
  Outros em ciano, sem classificação em cinza. Compromissos continuam azuis e horários avulsos, roxos.
- **+** adiciona **Horário avulso** (só título e hora — ex.: "Shopping Leblon, comprar roupa", sem cadastrar
  local nem compromisso), **Evento**, **Local (visita)** ou **Compromisso**. Tocar num horário vazio da linha do
  tempo já abre o menu com aquele horário.
- **Local** e **Evento** abrem uma escolha com **busca e filtros** iguais aos das abas (Aventura, Cultura, Bares,
  ♥ Date, Favoritos, Não visitados…; em eventos, "Sem data" primeiro). Escolhido, o formulário já vem com o horário.
- **Tocar num bloco** abre a ficha: adiar (+15 min, +1 h, +1 dia, +1 semana), antecipar, escolher outro horário,
  marcar como feito / "não aconteceu", cancelar só aquela vez, editar, **Terminei agora**, **Criar um Plano B**.
- **Arrastar direto na agenda** (de 15 em 15 min, sem abrir o item):
  - **segurar a borda de baixo** de um bloco (de 45 min ou mais) e arrastar muda só o **fim** (a duração) —
    ex.: o trabalho de 10–13 passa a terminar 12:00 só naquele dia;
  - **segurar o meio** do bloco seleciona e **move** (início e fim juntos);
  - o bloco selecionado ganha duas **bolinhas** (início e fim) e passa a responder na hora, sem segurar;
    tocar fora tira a seleção;
  - perto do topo ou do rodapé da tela a agenda rola sozinha.
- **↶ Desfazer / ↷ Refazer** ficam no canto esquerdo da agenda e valem para qualquer mudança (arrastar, apagar,
  Plano B, adiantar, editar…). Cada gesto é um passo.
- **Plano B**: **toque 3 vezes** num bloco (ou "Criar um Plano B" na ficha) e escolha outra coisa para o mesmo
  horário — local, evento, compromisso ou horário avulso. As opções ficam **lado a lado** (Opção A, B…) sem
  aviso de sobreposição. **Deslize para a esquerda** a que você não fez: a outra vira o item normal e vai para o
  Histórico. Se o horário passar sem você escolher, as opções ficam tracejadas ("escolha a opção") e nada vai
  para o Histórico até você escolher (na ficha: "Fiz esta opção").
- **Deslizar um bloco para a esquerda** tira da agenda (com Desfazer). Se era algo **que já tinha acontecido**,
  também sai do Histórico e o app pergunta **o que você fez nesse horário** (horário avulso, local, evento ou
  compromisso) para o Histórico ficar certo. Um local que só estava "visitado" por causa dele volta a não visitado.
- **Deslizar para os lados fora dos blocos** troca de dia (na faixa da semana, troca de semana). Tocar no mês abre o calendário.
- **Compromissos recorrentes** (diários, semanais, mensais): alterar uma ocorrência (ex.: adiar a terapia de
  amanhã em 24 h) vale **só para aquela vez**. As outras continuam no horário de sempre, e nenhum compromisso
  duplicado é criado. Dá para "voltar ao horário de sempre" a qualquer momento.
- **Mensais** usam o dia do mês (ex.: dia 5). Dias 29–31 caem no último dia nos meses mais curtos.
- **Quando um horário bate com outro, o app pergunta** (mostrando o resultado de cada escolha):
  - **Adiar tudo o que vem depois** (só naquele dia);
  - **Só atrasar o início do próximo** — ex.: dormiu até 9:30 → a terapia vira 9:30–10:00 e o resto não muda
    (ou, no sentido contrário, "só adiantar o fim" do anterior);
  - **Colocar o novo depois** (no primeiro horário livre);
  - **Manter sobreposto** (listrado, com ⚠);
  - **Cancelar** volta como estava. Em **Ajustes** dá para fixar uma dessas respostas e não ser mais perguntado.
- **Adiantar (fechar espaço)**: se você encurta algo (o trajeto previsto para 45 min levou 20), o aviso mostra
  "25 min livres · **Adiantar**", com as opções **adiantar só o próximo item** ou **adiantar tudo o que vem
  depois** naquele dia. Tocar num horário vazio antes de um item também oferece adiantá-lo, e
  **Terminei agora** (na ficha de algo em andamento) encerra o item e oferece o mesmo.

### Notificações
- Em qualquer item com horário (evento, visita a local, horário avulso, compromisso), toque no **sino**
  na ficha da agenda — ou ligue **Notificar antes** no formulário — e escolha a antecedência:
  na hora, 5/10/15/30 min, 1 h, 2 h, 3 h ou 1 dia. O padrão é **1 hora antes** (muda em Ajustes) e cada item
  pode ter a sua.
- O iPhone mostra o aviso ("Ópera Carmen — Começa em 1 hora — às 19:00 · Teatro Municipal") mesmo com o app fechado.
- Requer configurar uma vez um servidor gratuito na sua conta da Cloudflare: **[passo a passo](server/README.md)**.
  Ele guarda só o título e o horário dos avisos ligados.

### Conclusão automática e histórico
- Marcar um local como **visitado** (✓) registra no histórico.
- Qualquer item com horário na agenda (evento, visita a local, compromisso) cujo horário **passou sem
  alteração** é marcado como **feito** automaticamente e vai para o histórico. O local de um evento/visita
  concluído passa a constar como visitado.
- Se algo não aconteceu, toque nele (na agenda ou no histórico) → **Não aconteceu**.

## Seus dados

- Ficam **somente no iPhone** (IndexedDB), funcionam offline e não são enviados para nenhum servidor.
- Cada alteração é gravada numa transação atômica *antes* de aparecer na tela — se algo falhar, nada fica
  pela metade e o app avisa.
- Há uma **cópia de segurança local** (sem as fotos) que restaura os dados automaticamente se o banco principal
  for perdido.
- O app pede ao iOS armazenamento **persistente** (não apagar em caso de pouco espaço). Em Ajustes aparece
  "armazenamento protegido ✓" quando o iOS concede. Apps adicionados à Tela de Início não sofrem a limpeza
  automática de 7 dias do Safari.
- Atualizações do app nunca apagam dados: o banco só ganha o que falta (testado da versão 1 para a 2).
- **Importar lista**: Ajustes → **Importar lista** adiciona locais e eventos de um arquivo `.json` (formato
  `kind: "merge"`) sem apagar nada; itens com o mesmo nome dos que você já tem são ignorados. O arquivo também
  pode juntar locais repetidos (`mergePlaces: [{ keep, names }]`), levando eventos, visitas e histórico junto.
- **Backup**: Agenda → ⚙︎ (Ajustes) → **Exportar backup** gera um arquivo `.json` (com fotos) que você salva no
  app Arquivos / iCloud Drive. **Restaurar backup** recupera tudo — útil ao trocar de iPhone. O app lembra de
  fazer backup a cada 2 semanas.

**Limites honestos** (o que pode apagar os dados):
- Perder, trocar ou resetar o iPhone sem ter um backup — os dados não vão para a nuvem.
- Apagar o ícone do app da Tela de Início: a Apple não documenta claramente se os dados vão junto; trate como
  se fossem e exporte um backup antes.
- Usar pelo Safari em vez do ícone (os dados ficam em lugares separados).
- Mudar o endereço do app (renomear o repositório ou desligar o GitHub Pages).

---

## Desenvolvimento

Sem dependências e sem etapa de build: HTML + CSS + JavaScript (módulos ES).

```bash
python3 -m http.server 8765      # servir localmente → http://localhost:8765
npm test                         # testes da lógica da agenda (node:test)
node tests/e2e.cjs               # teste de ponta a ponta num iPhone emulado (requer Playwright)
node tests/agenda-drag.cjs       # arrastar na agenda (gestos de toque simulados)
node tests/agenda-reorg.cjs      # Plano B, deslizar, perguntar ao sobrepor, adiantar, desfazer/refazer
```

Estrutura:

```
index.html, manifest.webmanifest, sw.js   PWA (instalação + offline + recebimento de notificações)
css/app.css                               visual estilo iOS (modo escuro)
js/schedule.js                            lógica pura: recorrência, exceções por semana, conflitos, conclusão automática
js/store.js, js/db.js                     estado, ações e persistência (IndexedDB + cópia local)
js/forms.js, js/sheets.js                 formulários, escolhas com filtros e fichas
js/conflicts.js, js/reorg.js              perguntar ao sobrepor; Plano B, tirar da agenda, adiantar, terminar agora
js/views/                                 abas
js/push.js                                inscrição e sincronização dos avisos com o servidor
server/                                   servidor de notificações (Cloudflare Worker) — ver server/README.md
tests/                                    testes
```

Ao publicar uma nova versão, altere `VERSION` em `sw.js` **e** `APP_VERSION` em `js/version.js`. O app procura
atualização sempre que volta para a tela e reinicia sozinho quando a versão nova assume (esperando fechar
qualquer janela aberta). Em Ajustes há "Procurar atualização" e o número da versão instalada.
