# Demo video: The Page Is Lying (Codegeist 2026)

A HyperFrames project (HTML rendered to video). The narration is Deepgram Aura-2 (`aura-2-thalia-en`), one clip per scene.

| Output | Path | In git |
|---|---|---|
| Video, 1920x1080, 30 fps, H.264 + AAC | `out/the-page-is-lying-demo.mp4` | no (see `.gitignore`); re-render below |
| Captions (SRT) | `out/the-page-is-lying-demo.srt` | yes |
| Silent cut: no audio track, captions burned in under the picture | `out/the-page-is-lying-demo-silent.mp4` | no; `npm run silent` after a render |
| Devpost gallery stills | `out/still-*.png` | yes |

## Scenes

Scene length follows the narration audio; each clip starts 0.5 s into its scene.

| Scene | Start | Length | Source of the picture |
|---|---|---|---|
| s01 Problem | 0:00.0 | 33.0 s | Graphics. Sources on screen: SlashData Developer Nation Q1 2025; Atlassian State of Teams 2024 |
| s02 Setup | 0:33.0 | 21.6 s | Settings page from the local test build (labelled), filled with the live index values |
| s03 The page | 0:54.6 | 60.0 s | Live recording of "Payments API runbook (production)" (2 verified, 3 contradicted, 1 no evidence found), with citation overlays |
| s04 Evidence card | 1:54.6 | 10.0 s | Local test build (labelled): hover, Tab, permalink, Escape |
| s05 Rovo | 2:04.6 | 32.4 s | Live screenshot of the Rovo answer to "Can I still call POST /v1/charge?" |
| s06 MCP | 2:37.0 | 21.8 s | Live OAuth consent screenshot; MCP client results from 22 Nov 2026 (development install) set as text (labelled) |
| s07 Fix | 2:58.8 | 23.2 s | Live recordings before and after the fix (3 verified, 2 contradicted, 1 no evidence found). The edit itself is not filmed; the video says so |
| s08 Jira | 3:22.0 | 16.0 s | Local test build (labelled): Jira draft dialog |
| s09 Close | 3:38.0 | 15.0 s | Graphics |
| End | 3:53.0 | | |

## Files

- `index.html` mounts the scenes from `compositions/s01.html` to `s09.html` and places the narration clips.
- `assets/live/`: live recordings and screenshots. `assets/testbuild/`: shots from the local test build (`tools/capture-testbuild.mjs`) and `boxes.json` (element positions used by the overlays). `assets/audio/`: narration.
- `narration.md`: the script. `narration/sNN.txt`: the text sent to Deepgram. `narration/words/sNN.json`: word timings (used for captions and beat timing only).
- `raw/` (not in git): original recordings and the TTS output.

## Re-render

Needs Node 22+, FFmpeg and Chrome (HyperFrames downloads one if missing: `npx hyperframes browser ensure`).

```sh
cd video
npm install                 # HyperFrames only; kept out of the app's package.json
npx hyperframes lint
npx hyperframes check --json
npm run render              # out/the-page-is-lying-demo.mp4, about 15 to 25 minutes on a laptop
npm run captions            # out/the-page-is-lying-demo.srt
npm run silent              # out/the-page-is-lying-demo-silent.mp4 (needs ffmpeg with libass; FONTS_DIR=dir holding Inter-Medium.ttf)
```

Preview and edit in the browser with `npx hyperframes preview`, or in the HyperFrames desktop app.

Change a narration line:

1. Edit `narration/sNN.txt` (and `narration.md`).
2. `zsh tools/tts.sh sNN` (reads `DEEPGRAM_API_KEY` from the environment; the key is never printed). It writes `raw/sNN.mp3` and `assets/audio/sNN.mp3` and prints the new length.
3. Set `data-duration` of `vo-sNN` in `index.html` to that length. If the clip got longer, lengthen the scene host and shift the later scenes and clips.
4. `zsh tools/align.sh`, then `npm run captions`, then render.

Re-shoot the test-build images (from the repo root, after `npm install` there): `node video/tools/capture-testbuild.mjs`.

Gallery stills from a render (the five in out/ were taken at 74.6, 120.5, 145, 175.5 and 191 s):

```sh
cd video
for t in 74.6 120.5 145 175.5 191; do ffmpeg -v error -y -ss $t -i out/the-page-is-lying-demo.mp4 -frames:v 1 out/still-$t.png; done
```

## Upload (done by the owner)

YouTube:

1. studio.youtube.com, Create, Upload videos, choose `out/the-page-is-lying-demo.mp4`.
2. Title "The Page Is Lying: runbooks checked against the code (Codegeist 2026)". Visibility **Public** (Codegeist needs a public video under 5 minutes).
3. After upload: Subtitles, Add language English, Upload file, "With timing", choose `out/the-page-is-lying-demo.srt`.
4. Copy the link into the Devpost "Video demo link" field.

Vimeo: vimeo.com/upload, choose the MP4, privacy "Anyone". Then Settings, Distribution, Subtitles, "+", English, upload the SRT. Paste the link into Devpost.

Gallery: upload 3 to 5 of `out/still-*.png` to the Devpost image gallery: `still-1-page-contradicted.png` (the page with the contradiction card), `still-2-evidence-card.png` (evidence card with permalink), `still-3-rovo-answer.png` (the Rovo answer), `still-4-mcp-results.png` (MCP results table), `still-5-fixed-green.png` (the fix turning green).

## Wording and content rules used

- Verdict words on screen and in audio: "verified in code", "contradicted by code", "no evidence found" (the app's own labels "Verified", "Contradicted", "No evidence" appear where the real UI is shown).
- Every status has an icon and a label, not only a colour.
- Every number and citation matches the production check of `himanshu748/payments-api-demo` at commit `44c8112` (22 Nov 2026). The live recordings and the Rovo screenshot are from the production install; `tools/capture-live.mjs` re-shoots the page recordings.
