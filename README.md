# Drako — assistente pessoal por voz

O Drako é um assistente por voz em português do Brasil. A tela fica preta enquanto ele espera. Quando você diz **"Olá Drako"**, a interface holográfica acende e ele responde **"Olá, senhor."** A partir daí a conversa continua só por voz, até você dizer **"Drako até mais"**.

O cérebro é o **Claude Code rodando no seu Mac, com a sua assinatura Pro/Max**, sem precisar de chave de API paga à parte. O iPhone e o próprio Mac são a "boca e os ouvidos". Como alternativa, ainda existe o backend com a API da Anthropic (veja o fim deste documento).

A interface não tem campo de texto, botões, histórico nem legendas. O que acontece aparece só em animações:

| O que você vê | Significado |
|---|---|
| Tela preta com um ponto verde bem fraco embaixo | Esperando "Olá Drako" |
| Anéis verdes fracos pulsando no centro da tela preta | Falta tocar na tela uma vez (exigência do navegador) |
| Dragão aceso, ondulando devagar | Ouvindo você |
| Barras e analisador reagindo | Captando a sua fala |
| Radar girando, partículas em espiral | Pensando (o Claude Code está trabalhando) |
| Mandíbula se mexendo, barras grandes | Falando |
| Tudo âmbar com um escudo | Esperando você confirmar uma ação ("sim" ou "não") |
| Âmbar ou vermelho com um ícone cortado | Problema: microfone, rede, Mac fora do ar, login (o Drako também explica falando) |

## Como funciona

```
iPhone 12 Pro Max (Safari)  ─┐                    Mac
                             ├─ HTTPS privado ─▶  ponte do Drako (bridge/server.mjs)
Mac (Safari/Chrome) ─────────┘   (Tailscale)        ├─ serve a interface
                                                     └─ chama `claude -p` (Claude Code, sua assinatura)
```

- **Interface** (`index.html`, `css/`, `js/`): reconhecimento de voz, voz sintetizada e animações. Tudo roda no navegador.
- **Ponte local** (`bridge/`): um servidor pequeno em Node, sem dependências, que roda no Mac. Ele recebe o que você falou, chama o Claude Code em modo não interativo e devolve a resposta para ser falada. Mantém a conversa (sessão) enquanto o Drako está ativo.
- **Tailscale** (grátis): cria uma rede privada entre o iPhone e o Mac, com endereço HTTPS fixo. Só os seus aparelhos enxergam a ponte, e ela ainda exige a sua chave de acesso.

### Segurança das ações no Mac

- **Modo normal: somente leitura.** O Claude Code só pode ler arquivos, procurar arquivos e pesquisar na web. Ferramentas que alteram algo nem ficam disponíveis.
- **Para agir** (criar, editar ou apagar arquivos, rodar comandos), ele explica o que vai fazer e pergunta "Posso executar? Diga sim ou não." Só depois de um "sim" falado a ponte libera, **para aquele único pedido**, os comandos e a edição de arquivos. "Não" cancela. Respostas confusas fazem o Drako perguntar de novo.
- A confirmação é assinada pela ponte, então o navegador não consegue forjar um "sim".
- A pasta de trabalho padrão é a sua pasta pessoal. Dá para restringir, veja "Ajustes".

## O que já funciona de verdade

- Ativação por "Olá Drako" (inclusive com o pedido na mesma frase), "Olá, senhor." ao ativar, conversa contínua e "Drako até mais" para encerrar.
- O microfone desliga enquanto o Drako fala, para a própria voz não virar comando.
- Respostas do Claude Code faladas em português, com memória da conversa enquanto a sessão está ativa.
- Ler e procurar arquivos do Mac, pesquisar na web e, com confirmação por voz, criar ou editar arquivos e executar comandos no Mac.
- Avisos falados para: Mac fora do ar, Claude Code sem login, limite da assinatura atingido, microfone negado, sem internet.
- Testado de ponta a ponta com o Claude Code real: perguntar, pedir para criar um arquivo, confirmar com "sim" e o arquivo ser criado. Cada resposta levou de 5 a 7 segundos.

## Limitações reais

- **O Mac precisa estar ligado**, com você logado e a ponte rodando. O instalador deixa a ponte iniciando sozinha e impede o Mac de dormir por inatividade. **Com a tampa de um MacBook fechada ele dorme** (a menos que esteja ligado a um monitor externo e à tomada).
- **Mais lento que a API.** Cada resposta leva alguns segundos (o Claude Code inicia a cada pedido). Tarefas no Mac podem levar mais.
- **Usa os limites da sua assinatura**, compartilhados com o seu uso normal do Claude. Se o limite acabar, o Drako avisa.
- **Uso pessoal.** O login da assinatura é para você usar o Claude Code. Não use a ponte para oferecer o serviço a outras pessoas.
- **Um toque na tela por abertura.** O iOS e os navegadores só liberam a voz e o microfone depois de um toque. Não há botão: toque em qualquer lugar da tela preta.
- **Só funciona com a página aberta e a tela ligada.** Nenhum site ouve com o Safari fechado ou o iPhone bloqueado. O Drako pede para manter a tela acesa; para uso contínuo, deixe o iPhone carregando com ele aberto.
- **Ele não controla o iPhone.** As ações acontecem no Mac.
- Firefox não tem reconhecimento de voz; use Safari, Chrome ou Edge.

## Instalação no Mac

### 1. Node.js e Claude Code
1. Instale o **Node.js** (versão LTS) em <https://nodejs.org>.
2. Instale o **Claude Code** (<https://claude.com/claude-code>). No Terminal, rode `claude` uma vez e faça login com a sua conta **Pro ou Max**. Depois feche com `/exit`.

### 2. Baixar o Drako e instalar a ponte
No Terminal:

```bash
git clone https://github.com/giovanicicote-png/DrakoJarvis.git ~/DrakoJarvis
cd ~/DrakoJarvis
bash bridge/install-mac.sh
```

O instalador mostra dois endereços com a sua **chave de acesso**. A chave fica guardada em `~/.drako/config.json`; não compartilhe. Para remover a ponte: `bash bridge/install-mac.sh remover`. O registro de funcionamento fica em `~/Library/Logs/drako-bridge.log`.

> Enquanto este branch não estiver no `main`, use `git clone -b claude/charming-franklin-jhtq94 ...` no lugar do primeiro comando.

### 3. Usar no próprio Mac
Abra no Safari ou no Chrome o endereço `http://localhost:8787/#chave=...` mostrado pelo instalador, toque uma vez na tela e diga "Olá Drako". O endereço com a chave só é necessário na primeira vez; depois basta `http://localhost:8787`.

Se o macOS perguntar se o Node ou o Claude podem acessar a Mesa, Documentos ou Downloads, permita. Se o Drako disser que não consegue ler essas pastas, vá em Ajustes do Sistema → Privacidade e Segurança → Arquivos e Pastas (ou Acesso Total ao Disco) e permita o `node`.

### 4. Conectar o iPhone (Tailscale)
1. Instale o **Tailscale** no Mac (<https://tailscale.com/download>) e no iPhone (App Store). Entre com a **mesma conta** nos dois.
2. No painel <https://login.tailscale.com/admin/dns>, ative **MagicDNS** e **HTTPS Certificates**.
3. No Terminal do Mac:
   ```bash
   tailscale serve --bg 8787
   ```
   Se o comando não for encontrado, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8787`. Ele mostra um endereço como `https://seu-mac.tail1234.ts.net`. Esse endereço é fixo e só os seus aparelhos acessam.
4. No iPhone, deixe o Tailscale conectado e abra no Safari `https://seu-mac.tail1234.ts.net/#chave=SUA_CHAVE`.
5. Toque em **Compartilhar → Adicionar à Tela de Início** para abrir em tela cheia, como um app.

Para não precisar autorizar o microfone toda vez: Ajustes → Apps → Safari → Microfone → Permitir. O reconhecimento de voz do iPhone depende do Ditado (Ajustes → Geral → Teclado → Ativar Ditado). Vozes melhores em pt-BR: Ajustes → Acessibilidade → Conteúdo Falado → Vozes → Português (Brasil).

## Ajustes (`~/.drako/config.json`)

Depois de editar, reinicie a ponte com `bash bridge/install-mac.sh`.

```json
{
  "accessKey": "gerada automaticamente",
  "workdir": "/Users/SEU-USUARIO/Documents",
  "model": "sonnet",
  "port": 8787,
  "timeoutMs": 240000
}
```

- `workdir`: pasta onde o Drako trabalha (padrão: sua pasta pessoal).
- `model`: modelo do Claude Code (`sonnet`, `opus`, `haiku`...). Vazio usa o padrão do Claude Code. O `haiku` responde mais rápido e gasta menos do limite.
- `timeoutMs`: tempo máximo de cada pedido.

Também funcionam as variáveis de ambiente `DRAKO_WORKDIR`, `DRAKO_MODEL`, `DRAKO_PORT`, `DRAKO_HOST`, `DRAKO_CLAUDE_BIN`, `DRAKO_ACCESS_KEY` e `DRAKO_ALLOWED_ORIGINS`.

Para rodar a ponte manualmente, sem o instalador: `node bridge/server.mjs`.

## Usar pelo GitHub Pages (opcional)

A ponte já serve a interface, então o GitHub Pages não é necessário. Se quiser usá-lo mesmo assim, publique o `main` em Settings → Pages (branch `main`, pasta `/ (root)`) e abra:

```
https://giovanicicote-png.github.io/DrakoJarvis/#api=https://seu-mac.tail1234.ts.net/api&chave=SUA_CHAVE
```

## Alternativa: API da Anthropic (paga por uso)

A pasta `worker/` contém um backend para Cloudflare Workers que usa a API oficial da Anthropic. Ele funciona sem o Mac ligado e responde mais rápido, mas **é cobrado por uso**, à parte da assinatura. Para usar:

1. Cadastre os secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY` e `DRAKO_ACCESS_KEY` em Settings → Secrets and variables → Actions.
2. Rode o workflow **Publicar backend do Drako** na aba Actions.
3. Abra o site com `#api=https://drako.SEU-SUBDOMINIO.workers.dev&chave=SUA_DRAKO_ACCESS_KEY`.

As ferramentas da API ficam em `worker/src/tools.js`. As ações sensíveis também exigem um "sim" falado.

## Testes

```bash
cd worker && npm install && cd ..
npm test
```

Os testes cobrem a detecção das frases de voz, a ponte local (sessões, permissões por modo, confirmação assinada, arquivos públicos, erros de login e de limite, cancelamento) e o Worker.
