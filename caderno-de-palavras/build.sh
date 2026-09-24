#!/usr/bin/env bash
# Monta index.html a partir de src/ (visual + banco de palavras + lógica).
set -euo pipefail
cd "$(dirname "$0")"
{
  cat src/head.html
  echo '<script>'
  echo 'const BANK = [];'
  cat src/words-1.js src/words-2.js src/words-3.js src/words-4.js
  cat src/app.js
  echo '</script>'
} > index.html
echo "index.html gerado ($(wc -c < index.html) bytes)"
