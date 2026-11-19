#!/bin/zsh
# Word timings for each narration clip from Deepgram speech-to-text, used only to time captions
# and on-screen beats (caption text comes from narration/sNN.txt).  zsh video/tools/align.sh
set -euo pipefail
cd "${0:A:h}/.."
[[ -n "${DEEPGRAM_API_KEY:-}" ]] || { echo "DEEPGRAM_API_KEY is not set" >&2; exit 1; }
mkdir -p narration/words
for f in raw/s0*.mp3; do
  s=${f:t:r}
  curl -sS --fail -X POST "https://api.deepgram.com/v1/listen?model=nova-3&punctuate=false&smart_format=false" \
    -H "Authorization: Token $DEEPGRAM_API_KEY" -H "Content-Type: audio/mpeg" --data-binary "@$f" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const w=JSON.parse(d).results.channels[0].alternatives[0].words.map(x=>[x.word,+x.start.toFixed(3),+x.end.toFixed(3)]);process.stdout.write(JSON.stringify(w)+"\n")})' > "narration/words/$s.json"
  echo "$s $(node -e 'const w=require(process.argv[1]);console.log(w.length+" words, last ends "+w.at(-1)[2])' "$PWD/narration/words/$s.json")"
done
