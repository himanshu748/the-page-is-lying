#!/bin/zsh
# Regenerate one scene's narration with Deepgram Aura-2 (same voice as the other scenes).
#   zsh video/tools/tts.sh s08
# DEEPGRAM_API_KEY comes from the environment (zsh reads ~/.zshenv). The key is never echoed.
set -euo pipefail
cd "${0:A:h}/.."
scene="$1"
[[ -n "${DEEPGRAM_API_KEY:-}" ]] || { echo "DEEPGRAM_API_KEY is not set" >&2; exit 1; }
body=$(node -e 'process.stdout.write(JSON.stringify({text: require("fs").readFileSync(process.argv[1], "utf8").trim()}))' "narration/$scene.txt")
curl -sS --fail -X POST "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3" \
  -H "Authorization: Token $DEEPGRAM_API_KEY" -H "Content-Type: application/json" \
  --data "$body" -o "raw/$scene.mp3"
cp "raw/$scene.mp3" "assets/audio/$scene.mp3"
ffprobe -v error -show_entries format=duration -of csv=p=0 "raw/$scene.mp3"
echo "Update data-duration of vo-$scene in index.html (and the scene length if needed), then run tools/align.sh and npm run captions." >&2
