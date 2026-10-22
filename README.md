# Drako — assistente pessoal por voz

O Drako é um assistente por voz em português do Brasil. A tela fica preta enquanto ele espera. Quando você diz **"Olá Drako"**, a interface holográfica acende e ele responde **"Olá, senhor."** A partir daí a conversa continua só por voz, até você dizer **"Drako até mais"**. A inteligência vem do **Claude**, pela API oficial da Anthropic.

A interface não tem campo de texto, botões, histórico nem legendas. O que acontece aparece só em animações:

| O que você vê | Significado |
|---|---|
| Tela preta com um ponto verde bem fraco embaixo | Esperando "Olá Drako" |
| Anéis verdes fracos pulsando no centro da tela preta | Falta tocar na tela uma vez (exigência do navegador, veja abaixo) |
| Dragão aceso, ondulando devagar | Ouvindo você |
| Barras e analisador reagindo | Captando a sua fala |
| Radar girando, partículas em espiral | Pensando (consultando o Claude) |
| Mandíbula se mexendo, barras grandes | Falando |
| Tudo âmbar com um escudo | Esperando você confirmar uma ação sensível ("sim" ou "não") |
| Âmbar ou vermelho com um ícone cortado | Problema: microfone, rede, servidor ou permissão (o Drako também explica falando) |

## Arquitetura

```
iPhone/PC (Safari, Chrome, Edge)            Cloudflare Worker (grátis)            Anthropic
GitHub Pages: index.html + js/   ── HTTPS ─▶  worker/src/index.js        ── SDK ─▶  Claude
 - reconhecimento de voz do navegador        - guarda ANTHROPIC_API_KEY (secret)
 - voz sintetizada do navegador              - exige DRAKO_ACCESS_KEY
 - animações em canvas                       - executa ferramentas (worker/src/tools.js)
```

- **Frontend** (`index.html`, `css/`, `js/`): site estático, sem build, publicado pelo GitHub Pages.
  - `js/app.js`: máquina de estados (espera, ativo, pensando, falando, encerramento).
  - `js/voice.js`: escuta contínua com reinício automático, proteção contra eco e tratamento de erros; voz em pt-BR.
  - `js/phrases.js`: detecção de "Olá Drako", "Drako até mais", sim/não.
  - `js/brain.js`: comunicação com o backend.
  - `js/visual.js`: dragão holográfico e HUD.
- **Backend** (`worker/`): Cloudflare Worker com o SDK oficial `@anthropic-ai/sdk`. Usa o modelo `claude-opus-5-5` com esforço baixo (respostas rápidas para voz) e pesquisa na web. Se o modelo recusar um pedido por política, a própria API tenta automaticamente o modelo de reserva recomendado (`fallbacks: "default"`).

A chave da Anthropic **nunca** vai para o navegador nem para o repositório. Ela fica guardada como secret no Worker.

## O que já funciona de verdade

- Ativação por "Olá Drako" (inclusive com o pedido na mesma frase: "Olá Drako, que horas são?").
- "Olá, senhor." ao ativar e conversa contínua: depois de cada resposta ele volta a ouvir sozinho.
- "Drako até mais" encerra, ele diz "Até mais, senhor." e volta para a tela preta.
- O microfone fica desligado enquanto o Drako fala, há uma pausa curta depois da fala e frases parecidas com a última resposta são descartadas. Assim a voz dele não vira comando.
- Respostas do Claude faladas em português, com memória da conversa enquanto a sessão estiver ativa.
- Ferramentas reais: data e hora no seu fuso, e pesquisa na web (busca do próprio Claude).
- Confirmação por voz para ações sensíveis. O Worker não executa uma ferramenta marcada como sensível sem um "sim" falado, e a confirmação é assinada (HMAC) para não poder ser forjada pelo navegador.
- Tratamento de falhas, sempre explicado por voz e com indicação visual: microfone negado ou com defeito, reconhecimento de voz indisponível, sem internet, servidor fora do ar, chave errada, servidor sem chave da Anthropic, sobrecarga.
- Se o backend ainda não estiver configurado, o Drako **diz isso**. Ele não finge que está conectado.
- Após 10 minutos sem falar, ele volta sozinho para a espera.

## Limitações reais (iPhone e navegadores)

- **Um toque na tela por abertura.** O iOS e o Chrome só deixam um site falar (e, no iPhone, ligar o microfone) depois de um toque do usuário. Ao abrir o Drako, toque em qualquer lugar da tela preta uma vez. Não existe botão: a tela inteira serve. Depois disso tudo é por voz.
- **Permissão do microfone.** O Safari pode perguntar a cada visita. Para não perguntar mais: Ajustes → Apps → Safari → Microfone → Permitir. O reconhecimento de voz do iPhone depende da Siri e do Ditado (Ajustes → Geral → Teclado → Ativar Ditado).
- **Só funciona com a página aberta e a tela ligada.** Nenhum site consegue ouvir com o navegador fechado, em segundo plano ou com o iPhone bloqueado. O Drako pede para manter a tela acesa (Wake Lock, iOS 16.4 ou posterior). Mesmo assim, se o iPhone bloquear, a escuta para e volta quando você reabrir a página. Para uso contínuo, deixe o iPhone carregando com o Drako aberto. A tela preta gasta pouco em telas OLED.
- **Reconhecimento em nuvem.** No Chrome, o reconhecimento de voz usa servidores do Google. No Safari, usa os da Apple. Ambos precisam de internet.
- **Firefox não tem reconhecimento de voz.** Use Safari, Chrome ou Edge.
- **Voz.** O Drako usa a melhor voz pt-BR instalada no aparelho. No iPhone, dá para baixar vozes melhores em Ajustes → Acessibilidade → Conteúdo Falado → Vozes → Português (Brasil).
- **Ruído e fones.** Com caixa de som alta, ele pode captar o final da própria fala. O filtro de eco reduz isso, mas fones ajudam.
- **Ele não controla o iPhone.** Ele não abre apps, não lê arquivos, não envia mensagens e não faz compras. O Claude é instruído a dizer isso com honestidade quando você pedir.

## Configuração (pode ser feita toda pelo iPhone)

### 1. Chave da Anthropic
Em <https://console.anthropic.com>, crie uma conta, adicione créditos (a API é paga por uso) e gere uma **API key** em *API Keys*. Se a sua organização tiver a pesquisa na web desativada no Console, ative-a ou defina `DRAKO_WEB_SEARCH = "off"` no `worker/wrangler.toml`.

### 2. Conta na Cloudflare (grátis)
1. Crie uma conta em <https://dash.cloudflare.com>.
2. Abra **Workers & Pages** uma vez, para criar o seu subdomínio `*.workers.dev`.
3. Anote o **Account ID** (aparece na lateral do painel de Workers).
4. Em **My Profile → API Tokens → Create Token**, use o modelo **Edit Cloudflare Workers** e copie o token.

### 3. Secrets no GitHub
No repositório: **Settings → Secrets and variables → Actions → New repository secret**. Crie:

| Nome | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token do passo 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID do passo 2 |
| `ANTHROPIC_API_KEY` | chave do passo 1 |
| `DRAKO_ACCESS_KEY` | uma senha longa inventada por você (ex.: 30 letras e números aleatórios) |

### 4. Publicar o backend
Na aba **Actions**, abra **Publicar backend do Drako** e toque em **Run workflow**. Quando terminar, o endereço do Worker aparece no log, algo como `https://drako.SEU-SUBDOMINIO.workers.dev`. Para conferir, abra `https://drako.SEU-SUBDOMINIO.workers.dev/health`: deve mostrar `"configured": true`.

Se o seu GitHub Pages ficar em outro domínio, ajuste `ALLOWED_ORIGINS` em `worker/wrangler.toml` (só o domínio, sem o caminho) e publique de novo.

### 5. Publicar o site (GitHub Pages)
1. Junte este branch ao `main` (abra e aceite o pull request).
2. **Settings → Pages → Build and deployment → Deploy from a branch**, escolha `main` e `/ (root)` e salve.
3. O site fica em `https://giovanicicote-png.github.io/DrakoJarvis/`.

### 6. Conectar o site ao backend (uma vez por aparelho)
Abra no Safari do iPhone (e no computador) o endereço abaixo, trocando os dois valores:

```
https://giovanicicote-png.github.io/DrakoJarvis/#api=https://drako.SEU-SUBDOMINIO.workers.dev&chave=SUA_DRAKO_ACCESS_KEY
```

O Drako guarda isso só naquele aparelho e apaga do endereço na hora. A chave de acesso não fica em nenhum arquivo do repositório. Se preferir, o endereço do Worker (que não é segredo) pode ir em `js/config.js`, em `apiUrl`. Assim, nos outros aparelhos basta passar `#chave=...`.

Depois, toque em **Compartilhar → Adicionar à Tela de Início** para abrir em tela cheia, como um app.

## Adicionar ferramentas que executam ações reais

Edite `worker/src/tools.js`. Cada ferramenta é um objeto com `name`, `description`, `input_schema` e `run()`, e roda no servidor. Ações destrutivas, financeiras ou difíceis de desfazer devem ter `sensitive: true` e `confirmation(input)`. Com isso, o Worker devolve a pergunta ("Antes de continuar, preciso da sua confirmação: devo …? Diga sim ou não.") e só executa depois de um "sim" falado. Credenciais de serviços externos vão como novos secrets do Worker, nunca no código. O Claude só conhece as ferramentas listadas ali, então não pode afirmar que fez algo que não existe.

## Ajustes opcionais do backend (`worker/wrangler.toml`, seção `[vars]`)

- `DRAKO_MODEL`: modelo do Claude (padrão `claude-opus-5-5`).
- `DRAKO_EFFORT`: `low` (padrão, mais rápido), `medium` ou `high`.
- `DRAKO_WEB_SEARCH = "off"`: desliga a pesquisa na web.
- `DRAKO_FALLBACKS = "off"`: desliga o modelo de reserva em caso de recusa.

## Testes

```
cd worker && npm install && cd ..
npm test
```

Os testes cobrem a detecção das frases de voz e o Worker: autorização, origem, ferramentas, confirmação de ações sensíveis, assinatura contra confirmação forjada e validação do histórico.
