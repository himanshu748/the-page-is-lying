import { inCode, overlaps, type BlockContext, type Candidate, type Range } from './context';
import type { PackageEcosystem } from '../model';

const NOT_PACKAGE_WORDS: ReadonlySet<string> = new Set(
  `version versions step steps section chapter page pages release releases since from until upto up to and or the a an v ver rev revision
   build milestone phase item figure table line lines port ports day days hour hours minute minutes second seconds week weeks
   month months year years top about over under after before around approximately roughly` 
    .split(/\s+/)
    .filter((s) => s !== ''),
);

const VERSION = String.raw`\d+(?:\.(?:\d+|x|\*))*(?:-[0-9A-Za-z.]+)?`;

function emit(
  out: Candidate[],
  taken: Range[],
  range: Range,
  high: boolean,
  ecosystem: PackageEcosystem,
  name: string,
  rangeText: string,
): void {
  if (taken.some((t) => overlaps(t, range)) || name === '' || rangeText === '') return;
  taken.push(range);
  out.push({ ...range, high, normalized: { type: 'package_version', ecosystem, name, range: rangeText } });
}

/** Lower-cases and trims a version range. Idempotent. */
export function normalizeRange(range: string): string {
  return range.replace(/\s+/g, '').replace(/^v+(?=\d)/i, '');
}

export function extractPackages(ctx: BlockContext): Candidate[] {
  const out: Candidate[] = [];
  const taken: Range[] = [];
  const text = ctx.text;

  // Runtime phrases: "Node.js 20 or later", "Python >=3.11", "Node 18+".
  const runtimeRe = new RegExp(
    String.raw`(?<![\w@/.-])(Node\.js|NodeJS|Nodejs|Node|node|Python|python)(?![\w.])[ \t]+(?:v|version[ \t]+)?(>=|≥|>|<=|<|\^|~)?[ \t]*(${VERSION})(\+|[ \t]+or[ \t]+(?:later|newer|higher|above))?`,
    'g',
  );
  for (let m = runtimeRe.exec(text); m !== null; m = runtimeRe.exec(text)) {
    const word = m[1] ?? '';
    const range = { start: m.index, end: m.index + m[0].length };
    const high = inCode(ctx, range.start, range.end);
    if (/^[a-z]/.test(word) && !high) continue;
    const op = m[2] === '≥' ? '>=' : (m[2] ?? '');
    const open = m[4] !== undefined && m[4] !== '';
    const prefix = op !== '' ? op : open ? '>=' : '';
    emit(out, taken, range, high, 'runtime', word.toLowerCase().startsWith('python') ? 'python' : 'node', normalizeRange(prefix + (m[3] ?? '')));
  }

  // name@version (npm), module@vX.Y.Z (go).
  const atRe = new RegExp(
    String.raw`(?<![\w@/.-])((?:@[a-z0-9][\w.-]*/)?[a-z0-9][\w.-]*(?:/[\w.-]+)*)@(\^|~|>=|<=|>|<|=)?v?(${VERSION})`,
    'g',
  );
  for (let m = atRe.exec(text); m !== null; m = atRe.exec(text)) {
    const name = m[1] ?? '';
    const range = { start: m.index, end: m.index + m[0].length };
    const goModule = /^[a-z0-9-]+\.[a-z]{2,}\//.test(name);
    emit(out, taken, range, inCode(ctx, range.start, range.end), goModule ? 'go' : 'npm', name, normalizeRange((m[2] ?? '') + (m[3] ?? '')));
  }

  // pip style: name==1.2.3, name>=1.2 (code only).
  const pipRe = new RegExp(String.raw`(?<![\w@/.-])([A-Za-z][\w.-]*)(==|>=|<=|~=|!=)(${VERSION})`, 'g');
  for (let m = pipRe.exec(text); m !== null; m = pipRe.exec(text)) {
    const range = { start: m.index, end: m.index + m[0].length };
    if (!inCode(ctx, range.start, range.end)) continue;
    emit(out, taken, range, true, 'pypi', (m[1] ?? '').toLowerCase(), normalizeRange((m[2] ?? '') + (m[3] ?? '')));
  }

  // Maven coordinates group:artifact:1.2.3 (code only).
  const mavenRe = /(?<![\w@/.:-])([A-Za-z][\w.-]*:[A-Za-z][\w.-]*):(\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?)/g;
  for (let m = mavenRe.exec(text); m !== null; m = mavenRe.exec(text)) {
    const range = { start: m.index, end: m.index + m[0].length };
    if (!inCode(ctx, range.start, range.end)) continue;
    emit(out, taken, range, true, 'maven', m[1] ?? '', normalizeRange(m[2] ?? ''));
  }

  // "stripe 14.x", "stripe v14.1", "stripe 14.1.2".
  const spacedRe = new RegExp(String.raw`(?<![\w@/.-])([A-Za-z][\w.-]{1,59})[ \t]+(v)?(${VERSION})(?![\w.@-])`, 'g');
  for (let m = spacedRe.exec(text); m !== null; m = spacedRe.exec(text)) {
    const name = m[1] ?? '';
    const version = m[3] ?? '';
    const range = { start: m.index, end: m.index + m[0].length };
    if (NOT_PACKAGE_WORDS.has(name.toLowerCase()) || /\.[A-Za-z]{1,5}$/.test(name) && !/^[a-z0-9-]+\.js$/i.test(name)) continue;
    const high = inCode(ctx, range.start, range.end);
    const dotted = version.includes('.');
    const explicit = m[2] !== undefined || /\.(x|\*)/.test(version) || (version.match(/\./g)?.length ?? 0) >= 2;
    if (high ? !dotted : !(dotted && explicit)) continue;
    emit(out, taken, range, high, 'npm', name.toLowerCase(), normalizeRange(version));
  }

  return out;
}
