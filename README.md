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
| **Locais** | Cadastro de lugares com nome, endereço, foto e classificação. Busca por nome, filtros, ★ favorito e ✓ visitado direto na lista. |
| **Eventos** | Eventos sempre ligados a um local cadastrado, com data/hora opcional, classificação e favorito. |
| **Compromissos** | Lista da sua rotina, agrupada por frequência: **diário**, **semanal**, **mensal** ou **único**. |
| **Favoritos** | Locais e eventos marcados com ★, com filtro por tipo. |
| **Histórico** | Tudo que já foi feito, com data e horário. |

### Agenda
- **+** adiciona **Horário avulso** (só título e hora — ex.: "Shopping Leblon, comprar roupa", sem cadastrar
  local nem compromisso), **Evento**, **Local (visita)** ou **Compromisso**. Tocar num horário vazio da linha do
  tempo já abre o menu com aquele horário.
- **Tocar num bloco** abre a ficha: adiar (+15 min, +1 h, +1 dia, +1 semana), antecipar, escolher outro horário,
  marcar como feito / "não aconteceu", cancelar só aquela semana, editar.
- **Segurar e arrastar** um bloco muda o horário (de 15 em 15 minutos).
- **Deslizar para os lados** troca de dia (na faixa da semana, troca de semana). Tocar no mês abre o calendário.
- **Compromissos recorrentes** (diários, semanais, mensais): alterar uma ocorrência (ex.: adiar a terapia de
  amanhã em 24 h) vale **só para aquela vez**. As outras continuam no horário de sempre, e nenhum compromisso
  duplicado é criado. Dá para "voltar ao horário de sempre" a qualquer momento.
- **Mensais** usam o dia do mês (ex.: dia 5). Dias 29–31 caem no último dia nos meses mais curtos.
- **Conflitos de horário**: quando algo novo cai em cima de um horário ocupado, o app avisa e oferece
  *adiar o que já estava marcado* (em cascata), *colocar o novo depois* ou *manter sobreposto*. Em **Ajustes**
  você define um comportamento padrão. Blocos sobrepostos ficam listrados com ⚠.

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
```

Estrutura:

```
index.html, manifest.webmanifest, sw.js   PWA (instalação + offline)
css/app.css                               visual estilo iOS (modo escuro)
js/schedule.js                            lógica pura: recorrência, exceções por semana, conflitos, conclusão automática
js/store.js, js/db.js                     estado, ações e persistência (IndexedDB + cópia local)
js/forms.js, js/sheets.js                 formulários e fichas
js/views/                                 abas
tests/                                    testes
```

Ao publicar uma nova versão, altere `VERSION` em `sw.js` para que os iPhones baixem os arquivos novos.
