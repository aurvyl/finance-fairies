#!/usr/bin/env bash
# Store a Gemini API key in engine/.env.local (git-ignored) and check that it works.
# The key is read without echo and is never printed.
#
#   bash engine/scripts/set_gemini_key.sh
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ENGINE_DIR/.env.local"
VAR="${1:-GEMINI_API_KEY}"

printf 'Paste your %s (input hidden), then press Enter: ' "$VAR"
IFS= read -rs KEY
echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
if [ -z "$KEY" ]; then
  echo "No key entered; nothing changed." >&2
  exit 1
fi

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
TMP="$(mktemp)"
grep -v "^${VAR}=" "$ENV_FILE" > "$TMP" || true
printf '%s=%s\n' "$VAR" "$KEY" >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset KEY
echo "Saved $VAR to $ENV_FILE (ending ...$(grep "^${VAR}=" "$ENV_FILE" | tail -c 5))"

[ "$VAR" = "GEMINI_API_KEY" ] || exit 0
echo "Checking the key with one small Gemini call..."
cd "$ENGINE_DIR"
uv run --project . python - <<'EOF'
import sys
from google import genai
from guardian.llm import PROVIDERS, resolve_key

model = PROVIDERS["gemini"]["default_model"]
try:
    client = genai.Client(api_key=resolve_key("gemini"))
    reply = client.interactions.create(model=model, input="Reply with the single word: ready")
    print(f"OK: {model} answered: {(reply.output_text or '').strip()[:40]}")
except Exception as exc:
    msg = str(exc)
    print(f"Key saved, but the check failed: {type(exc).__name__}: {msg[:200]}")
    sys.exit(2)
EOF
