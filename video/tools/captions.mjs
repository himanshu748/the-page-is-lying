#!/usr/bin/env node
// Builds out/the-page-is-lying-demo.srt from the narration text (narration/sNN.txt) and the word
// timings of each clip (narration/words/sNN.json, from tools/align.sh). Cue text is the script, not
// the transcript; the transcript only supplies timing. Scene offsets come from the <audio> tags in index.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const index = readFileSync(`${root}index.html`, 'utf8');
const offsets = Object.fromEntries(
  [...index.matchAll(/<audio id="vo-(s\d\d)"[^>]*?data-start="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])]),
);

// Spoken forms in the script, shown in their written form on screen.
const DISPLAY = [
  [/POST slash v1 slash charge/g, 'POST /v1/charge'],
  [/POST slash v2 slash payments/g, 'POST /v2/payments'],
  [/src routes dot t s, line eighty-eight/g, 'src/routes.ts, line 88'],
  [/src config dot t s, line eight/g, 'src/config.ts, line 8'],
  [/PAYMENTS underscore API underscore KEY/g, 'PAYMENTS_API_KEY'],
  [/STRIPE underscore KEY/g, 'STRIPE_KEY'],
  [/thirty-one percent/g, '31%'],
  [/forty-six percent/g, '46%'],
  [/fifty-five percent/g, '55%'],
];
const display = (s) => DISPLAY.reduce((t, [re, to]) => t.replace(re, to), s);
const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').length;

const MAX = 84;
function chunks(text) {
  const out = [];
  for (const sentence of text.split(/(?<=[.?!])\s+/)) {
    let rest = sentence;
    while (display(rest).length > MAX) {
      // Split at the punctuation or space closest to the middle of what is left.
      const mid = rest.length / 2;
      let best = -1;
      for (const m of rest.matchAll(/[,:]\s|\s/g)) {
        const at = m.index + 1;
        const score = Math.abs(at - mid) - (m[0].trim() ? 12 : 0);
        if (best < 0 || score < Math.abs(best - mid) - (/[,:]/.test(rest[best - 1]) ? 12 : 0)) best = at;
      }
      out.push(rest.slice(0, best).trim());
      rest = rest.slice(best).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

const ts = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const wrap = (s) => {
  if (s.length <= 42) return s;
  const mid = s.length / 2;
  let best = s.indexOf(' ');
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  return `${s.slice(0, best)}\n${s.slice(best + 1)}`;
};

const cues = [];
for (const scene of Object.keys(offsets).sort()) {
  const text = readFileSync(`${root}narration/${scene}.txt`, 'utf8').trim();
  const words = JSON.parse(readFileSync(`${root}narration/words/${scene}.json`, 'utf8'));
  const cum = [];
  let total = 0;
  for (const [w] of words) cum.push((total += letters(w)));
  const parts = chunks(text);
  const narrTotal = letters(text);
  let pos = 0;
  const wordAt = (L) => Math.min(words.length - 1, cum.findIndex((c) => c >= L) === -1 ? words.length - 1 : cum.findIndex((c) => c >= L));
  for (const part of parts) {
    const a = (pos / narrTotal) * total;
    pos += letters(part);
    const b = (pos / narrTotal) * total;
    const first = wordAt(a + 0.5);
    const last = wordAt(b - 0.5);
    cues.push({ start: offsets[scene] + words[first][1], end: offsets[scene] + words[last][2], text: display(part) });
  }
}
for (let i = 0; i < cues.length; i++) {
  const next = cues[i + 1];
  cues[i].end = Math.max(cues[i].end, cues[i].start + 1.0);
  if (next) cues[i].end = Math.min(cues[i].end + 0.25, next.start - 0.04);
}
const srt = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${wrap(c.text)}\n`).join('\n');
writeFileSync(`${root}out/the-page-is-lying-demo.srt`, srt);
console.log(`${cues.length} cues, last ends ${ts(cues.at(-1).end)}`);
