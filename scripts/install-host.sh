#!/bin/bash
# Installs the Native Messaging host manifest for Dia (and Chrome, if present).
# The browser launches the host without the shell PATH, so the wrapper
# pins an absolute node path.
set -euo pipefail

HOST_NAME="com.mordol.llm_translate"
EXTENSION_ID="mdnkgmlieapipiojgefbbmjbafdebhgg"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
WRAPPER="$ROOT/host/run-host.sh"

cat > "$WRAPPER" <<EOF
#!/bin/bash
exec "$NODE_BIN" "$ROOT/host/host.js" "\$@"
EOF
chmod +x "$WRAPPER"

TARGET_DIRS=(
  "$HOME/Library/Application Support/Dia/User Data/NativeMessagingHosts"
)
if [ -d "$HOME/Library/Application Support/Google/Chrome" ]; then
  TARGET_DIRS+=("$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts")
fi

for dir in "${TARGET_DIRS[@]}"; do
  mkdir -p "$dir"
  cat > "$dir/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "LLM Translate PoC host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "installed: $dir/$HOST_NAME.json"
done
echo "node: $NODE_BIN"
