#!/usr/bin/env node
// Make the silent cut: no audio track, the picture at 90% with the captions burned into a band below it.
// Reads out/the-page-is-lying-demo.mp4 and .srt (npm run render, npm run captions).
//   [FONTS_DIR=dir with Inter-Medium.ttf] node tools/silent-cut.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const base = 'out/the-page-is-lying-demo';
const ass = `${base}.ass`;
const stamp = (t) => t.replace(',', '.').replace(/^0(\d:)/, '$1').slice(0, -1);
const cues = readFileSync(`${base}.srt`, 'utf8').trim().split(/\r?\n\r?\n/).map((block) => {
  const [, time, ...text] = block.split(/\r?\n/);
  const [start, end] = time.split(' --> ');
  return `Dialogue: 0,${stamp(start)},${stamp(end)},Default,,0,0,0,,{\\an5\\pos(960,1026)}${text.join('\\N')}`;
});
writeFileSync(ass, `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter Medium,38,&H00F5F0EB,&H00F5F0EB,&H00201109,&H00201109,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.join('\n')}
`);
const fonts = process.env.FONTS_DIR ? `:fontsdir=${process.env.FONTS_DIR}` : '';
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${base}.mp4`,
  '-vf', `scale=1728:972:flags=lanczos,pad=1920:1080:96:0:color=0x0B1120,subtitles=${ass}${fonts}`,
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  `${base}-silent.mp4`], { stdio: 'inherit' });
console.log(`${base}-silent.mp4`);
