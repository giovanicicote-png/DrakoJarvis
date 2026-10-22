#!/bin/bash
# Instala a ponte do Drako no Mac para iniciar sozinha no login.
#   bash bridge/install-mac.sh            instala ou atualiza
#   bash bridge/install-mac.sh remover    desinstala
set -euo pipefail

LABEL="com.drako.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/drako-bridge.log"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "remover" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Ponte do Drako removida."
  exit 0
fi

NODE="$(command -v node || true)"
CLAUDE="$(command -v claude || true)"
if [ -z "$NODE" ]; then
  echo "Node.js não encontrado. Instale em https://nodejs.org (versão 18 ou mais nova) e rode de novo."
  exit 1
fi
if [ -z "$CLAUDE" ]; then
  echo "Claude Code não encontrado. Instale (https://claude.com/claude-code), rode 'claude' uma vez para fazer login e tente de novo."
  exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js $NODE_MAJOR é antigo demais; instale a versão 18 ou mais nova."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <!-- caffeinate -i impede o Mac de dormir por inatividade enquanto a ponte roda -->
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>$NODE</string>
    <string>$REPO/bridge/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$CLAUDE"):$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>DRAKO_CLAUDE_BIN</key><string>$CLAUDE</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

# Gera a chave de acesso (~/.drako/config.json) antes de iniciar o serviço.
"$NODE" --input-type=module -e "const m = await import('$REPO/bridge/server.mjs'); await m.loadConfig();"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 2

KEY="$("$NODE" -p 'JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.drako/config.json","utf8")).accessKey' 2>/dev/null || true)"
echo
echo "Ponte do Drako instalada e rodando (inicia sozinha quando você entrar no Mac)."
echo "Registro: $LOG"
echo
echo "Neste Mac, abra no Safari ou Chrome:"
echo "  http://localhost:8787/#chave=$KEY"
echo
echo "No iPhone (com o Tailscale ligado), depois de rodar 'tailscale serve --bg 8787':"
echo "  https://NOME-DO-SEU-MAC.SUA-REDE.ts.net/#chave=$KEY"
