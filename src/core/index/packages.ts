/**
 * Package manifest index: package.json (dependencies, engines), requirements.txt,
 * pyproject.toml (PEP 621 and Poetry), go.mod, pom.xml and Gradle files.
 * Python names are normalized per PEP 503 (lowercase, runs of "-_." become "-").
 */
import type { PackageEntry } from '../model';
import { mapGet, parseTomlLite, scalarString } from './structured';
import type { TreeNode } from './structured';
import { lineAt, lineStarts, snippetOf, splitLines } from './text';
import type { IndexAcc } from './types';

export function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function add(acc: IndexAcc, lines: string[], file: string, e: Omit<PackageEntry, 'file' | 'snippet'>): void {
  acc.packages.push({ ...e, file, snippet: snippetOf(lines, e.line) });
}

export function indexPackageJson(acc: IndexAcc, file: string, text: string, tree: TreeNode): void {
  const lines = splitLines(text);
  acc.manifestsParsed++;
  if (file === 'package.json') {
    const name = scalarString(mapGet(tree, 'name')?.value);
    if (name) acc.packageName = name;
  }
  for (const [section, dev] of [
    ['dependencies', false],
    ['peerDependencies', false],
    ['optionalDependencies', false],
    ['devDependencies', true],
  ] as const) {
    const sec = mapGet(tree, section);
    if (!sec || sec.value.kind !== 'map') continue;
    for (const dep of sec.value.entries) {
      const range = scalarString(dep.value);
      if (range !== undefined) add(acc, lines, file, { ecosystem: 'npm', name: dep.key, range, dev, line: dep.line });
    }
  }
  const engines = mapGet(tree, 'engines');
  if (engines && engines.value.kind === 'map') {
    for (const e of engines.value.entries) {
      const range = scalarString(e.value);
      if (range !== undefined && (e.key === 'node' || e.key === 'npm')) {
        add(acc, lines, file, { ecosystem: 'runtime', name: e.key, range, dev: false, line: e.line });
      }
    }
  }
}

export function indexRequirements(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  acc.manifestsParsed++;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('-') || /^(?:git\+|https?:|\.|\/)/.test(line)) return;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*((?:[<>=!~]=?|===)[^;#]*)?(?:;.*)?$/.exec(line);
    if (!m) return;
    const range = (m[2] ?? '').replace(/\s+/g, '');
    add(acc, lines, file, { ecosystem: 'pypi', name: normalizePyName(m[1] as string), range: range === '' ? '*' : range, dev: /(?:^|[-_/])(?:dev|test|tests|lint|docs)[-_.]/.test(file.toLowerCase()), line: i + 1 });
  });
}

function pep508(spec: string): { name: string; range: string } | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(\([^)]*\)|(?:[<>=!~]=?|===)[^;]*)?/.exec(spec);
  if (!m) return undefined;
  const range = (m[2] ?? '').replace(/[()\s]/g, '');
  return { name: normalizePyName(m[1] as string), range: range === '' ? '*' : range };
}

export function indexPyproject(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  const toml = parseTomlLite(text);
  acc.manifestsParsed++;
  const addSpecs = (key: string, dev: boolean): void => {
    const v = toml.get(key);
    for (const item of v?.items ?? []) {
      const p = pep508(item.value);
      if (p) add(acc, lines, file, { ecosystem: 'pypi', name: p.name, range: p.range, dev, line: item.line });
    }
  };
  addSpecs('project.dependencies', false);
  for (const key of toml.keys()) {
    if (key.startsWith('project.optional-dependencies.')) addSpecs(key, true);
    if (key.startsWith('dependency-groups.')) addSpecs(key, true);
  }
  const rp = toml.get('project.requires-python');
  if (rp?.str) add(acc, lines, file, { ecosystem: 'runtime', name: 'python', range: rp.str, dev: false, line: rp.line });
  // Poetry
  for (const [prefix, dev] of [
    ['tool.poetry.dependencies.', false],
    ['tool.poetry.dev-dependencies.', true],
  ] as const) {
    for (const [key, v] of toml) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (name === 'python') {
        if (v.str) add(acc, lines, file, { ecosystem: 'runtime', name: 'python', range: v.str, dev: false, line: v.line });
        continue;
      }
      if (name.includes('.')) continue;
      add(acc, lines, file, { ecosystem: 'pypi', name: normalizePyName(name), range: v.str ?? '*', dev, line: v.line });
    }
  }
  for (const [key, v] of toml) {
    const g = /^tool\.poetry\.group\.[\w-]+\.dependencies\.([\w.-]+)$/.exec(key);
    if (g && !(g[1] as string).includes('.')) add(acc, lines, file, { ecosystem: 'pypi', name: normalizePyName(g[1] as string), range: v.str ?? '*', dev: true, line: v.line });
  }
}

/** Script names from [project.scripts] and [tool.poetry.scripts]. */
export function pyprojectScripts(text: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  for (const [key, v] of parseTomlLite(text)) {
    const m = /^(?:project|tool\.poetry)\.scripts\.([\w.-]+)$/.exec(key);
    if (m) out.push({ name: m[1] as string, line: v.line });
  }
  return out;
}

export function indexGoMod(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  acc.manifestsParsed++;
  let inBlock = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line === '') return;
    const goV = /^go\s+(\d[\w.]*)/.exec(line);
    if (goV) {
      add(acc, lines, file, { ecosystem: 'runtime', name: 'go', range: goV[1] as string, dev: false, line: i + 1 });
      return;
    }
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      return;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      return;
    }
    const single = /^require\s+(\S+)\s+(v\S+)(.*)$/.exec(line);
    const block = inBlock ? /^(\S+)\s+(v\S+)(.*)$/.exec(line) : null;
    const m = single ?? block;
    if (!m) return;
    if (/\/\/\s*indirect/.test(m[3] as string)) return;
    add(acc, lines, file, { ecosystem: 'go', name: m[1] as string, range: m[2] as string, dev: false, line: i + 1 });
  });
}

export function indexPom(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  const starts = lineStarts(text);
  acc.manifestsParsed++;
  for (const m of text.matchAll(/<dependency>([\s\S]{0,800}?)<\/dependency>/g)) {
    const body = m[1] as string;
    const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(body)?.[1];
    const a = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(body)?.[1];
    if (!g || !a) continue;
    const v = /<version>\s*([^<\s]+)\s*<\/version>/.exec(body)?.[1] ?? '*';
    const scope = /<scope>\s*([^<\s]+)\s*<\/scope>/.exec(body)?.[1];
    const gOff = m.index + m[0].indexOf(`<artifactId>`);
    add(acc, lines, file, { ecosystem: 'maven', name: `${g}:${a}`, range: v, dev: scope === 'test', line: lineAt(starts, gOff) });
  }
}

export function indexGradle(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  acc.manifestsParsed++;
  lines.forEach((raw, i) => {
    const m = /^\s*(\w*[Ii]mplementation|api|compileOnly|runtimeOnly|\w*[Tt]estImplementation|annotationProcessor|kapt)\s*\(?\s*['"]([^'":\s]+):([^'":\s]+)(?::([^'"\s]+))?['"]/.exec(raw);
    if (!m) return;
    add(acc, lines, file, { ecosystem: 'maven', name: `${m[2]}:${m[3]}`, range: m[4] ?? '*', dev: /test/i.test(m[1] as string), line: i + 1 });
  });
}
