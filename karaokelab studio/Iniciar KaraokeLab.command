#!/bin/bash
# ── KaraokeLab Studio 1-Click Launcher (http://localhost:3000/) ──

PROJECT_DIR="/Users/gino/Documents/APP Creations/karaokelab studio"
cd "$PROJECT_DIR" || exit 1

export PATH="$HOME/.cargo/bin:$PATH:/usr/local/bin:/opt/homebrew/bin"

# Check if Vite dev server is running on port 3000
if ! lsof -i :3000 > /dev/null 2>&1; then
  echo "🚀 Iniciando servidor KaraokeLab Studio en http://localhost:3000..."
  npm run dev > /dev/null 2>&1 &
  sleep 2
fi

# Open Chrome / PWA or default browser
if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "http://localhost:3000/"
else
  open "http://localhost:3000/"
fi

echo "✓ KaraokeLab Studio abierto con éxito en http://localhost:3000/"
