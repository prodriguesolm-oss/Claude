# Servidor de notificações do Agentonator

O iPhone não deixa um app da Tela de Início agendar sozinho uma notificação para mais tarde
(com o app fechado). Quem envia o aviso na hora certa é este pequeno servidor, que roda de graça
na sua conta da **Cloudflare** (Workers, plano gratuito).

**O que fica no servidor:** só o título, o texto e o horário dos avisos que estão **ligados**
(ex.: "Ópera Carmen — Começa em 1 hora — às 19:00 · Teatro Municipal"), mais o "endereço" de
notificação do seu iPhone. Locais, fotos, histórico e o resto ficam só no iPhone.
O conteúdo enviado à Apple vai criptografado (só o seu iPhone consegue ler).

---

## Configurar (uma vez, ~10 minutos)

Dá para fazer tudo pelo Safari do iPhone, mas é mais confortável no computador.
Os nomes dos botões da Cloudflare podem variar um pouco com o tempo.

### 1. Criar a conta
Acesse **dash.cloudflare.com** e crie uma conta gratuita (e-mail + senha). Confirme o e-mail.

### 2. Criar o servidor a partir do GitHub
1. No painel, abra **Workers & Pages** (no menu "Compute") → **Create** (Criar).
2. Na aba **Workers**, escolha **Import a repository** (Importar um repositório) e conecte sua conta
   do GitHub quando pedir — autorize o acesso ao repositório **Claude**.
3. Selecione o repositório **prodriguesolm-oss/Claude** e configure:
   - **Project name:** `agentonator-push`
   - **Branch:** `claude/agentonator-iphone-app-36g8wk` (ou `main`, se você já tiver juntado as mudanças)
   - Em **Advanced settings → Path / Root directory:** `server`
   - Deixe o *build command* vazio e o *deploy command* como `npx wrangler deploy`
4. Toque em **Save and Deploy** (Salvar e publicar) e espere ~1 minuto.
   Se for o seu primeiro Worker, a Cloudflare pede para escolher um subdomínio `workers.dev` — escolha
   qualquer nome.

### 3. Copiar o endereço
Ao terminar, a Cloudflare mostra o endereço do servidor, algo como:

```
https://agentonator-push.SEU-SUBDOMINIO.workers.dev
```

Abrindo esse endereço no navegador, deve aparecer `{"ok":true,"app":"agentonator-push"}`.

### 4. Ativar no app
1. Abra o Agentonator **pelo ícone da Tela de Início** (no Safari não funciona — regra do iOS; precisa de iOS 16.4 ou mais novo).
2. **Agenda → botão de ajustes (canto superior direito) → Notificações**.
3. Cole o endereço no campo **Servidor** e toque em **Ativar notificações** → **Permitir**.
4. Toque em **Enviar notificação de teste**. Em alguns segundos o aviso deve aparecer no iPhone.

Pronto. Agora, em qualquer item da agenda, toque no **sino** e escolha a antecedência
(padrão: 1 hora antes; dá para mudar o padrão em Ajustes e escolher outra em cada item).

---

## Perguntas comuns

**Custa alguma coisa?** Não. O uso de um aparelho fica muito abaixo dos limites do plano gratuito.

**E se eu mudar o horário de um evento?** O app reenvia a lista de avisos sempre que algo muda
e toda vez que é aberto; o servidor substitui a lista antiga — não chega aviso duplicado nem no horário velho.

**Compromissos que se repetem?** O app manda os avisos dos próximos 45 dias e renova a cada vez que é
aberto. Se você ficar mais de 45 dias sem abrir o app, os avisos repetitivos param até a próxima abertura.

**O teste não chega.** Confira: (1) o app foi aberto pelo ícone; (2) Ajustes do iPhone → Notificações →
Agentonator → Permitir Notificações; (3) o Modo Foco/Não Perturbe não está silenciando; (4) o endereço
do servidor está certo (abra-o no navegador). O diagnóstico do servidor fica em
`https://SEU-ENDERECO/status?device=...` (o código do aparelho aparece só internamente no app).

**Como desligar?** No app: Ajustes → Notificações → **Desativar notificações** (apaga tudo do servidor).
Para remover o servidor de vez: painel da Cloudflare → Workers & Pages → agentonator-push → Settings → Delete.

---

## Para desenvolvedores

```bash
cd server
npm install
npm test                 # criptografia (vs. referência http_ece) + integração local com wrangler dev
node test/app-e2e.mjs    # app + servidor + serviço de push falso (requer Playwright/Chromium)
npx wrangler deploy      # publicar
```

Rotas: `GET /vapid?device=`, `GET /status?device=`, `POST /sync`, `POST /test`, `POST /disable`.
Cada aparelho tem um Durable Object (SQLite) que guarda a inscrição e os lembretes e agenda um
*alarm* para o próximo aviso. Web Push implementado só com WebCrypto (VAPID RFC 8292 + aes128gcm RFC 8291).
