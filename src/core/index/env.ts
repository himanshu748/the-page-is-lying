/**
 * Environment variable index: reads in code (JS/TS, Python, Go, Java, Ruby), `.env.example`,
 * Docker Compose `environment` and Kubernetes `env`. A dynamic read (`process.env[name]`,
 * `os.environ[var]`, a whole-object pass) sets env coverage to partial.
 */
import type { EnvEntry } from '../model';
import { mapGet, scalarString } from './structured';
import type { TreeNode } from './structured';
import { lineAt, lineStarts, snippetOf, splitLines, stringLiteral } from './text';
import type { IndexAcc } from './types';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function push(acc: IndexAcc, file: string, lines: string[], line: number, name: string, source: EnvEntry['source']): void {
  if (!ENV_NAME.test(name)) return;
  acc.env.push({ file, line, snippet: snippetOf(lines, line), name, source });
  acc.sawStaticEnv = true;
}

export function indexEnvInCode(acc: IndexAcc, file: string, original: string, masked: string, ext: string): void {
  const lines = splitLines(original);
  const starts = lineStarts(masked);
  const add = (offset: number, name: string): void => push(acc, file, lines, lineAt(starts, offset), name, 'code');

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) {
    for (const m of masked.matchAll(/\bprocess\s*\.\s*env\s*\.\s*([A-Za-z_][\w]*)/g)) add(m.index, m[1] as string);
    for (const m of masked.matchAll(/\bimport\s*\.\s*meta\s*\.\s*env\s*\.\s*([A-Za-z_][\w]*)/g)) add(m.index, m[1] as string);
    for (const m of masked.matchAll(/\b(?:process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env|Bun\s*\.\s*env)\s*\[\s*(?:(['"`])([^'"`\n$]*)\1|([^\]\n]*))\s*\]/g)) {
      if (m[2] !== undefined && m[1] !== undefined) add(m.index, m[2]);
      else acc.partial.env = true;
    }
    for (const m of masked.matchAll(/\bDeno\s*\.\s*env\s*\.\s*get\s*\(\s*(?:(['"])([^'"\n]*)\1|([^)\n]*))/g)) {
      if (m[2] !== undefined) add(m.index, m[2]);
      else acc.partial.env = true;
    }
    for (const m of masked.matchAll(/\bBun\s*\.\s*env\s*\.\s*([A-Za-z_]\w*)/g)) add(m.index, m[1] as string);
    // const { A, B: renamed, ...rest } = process.env
    for (const m of masked.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env)\b/g)) {
      const body = m[1] as string;
      const bodyStart = m.index + m[0].indexOf('{') + 1;
      let cursor = 0;
      for (const part of body.split(',')) {
        const name = /^\s*([A-Za-z_]\w*)\s*(?::|=|$)/.exec(part);
        if (/^\s*\.\.\./.test(part)) acc.partial.env = true;
        else if (name) add(bodyStart + cursor + (name.index ?? 0) + (name[0].length - name[0].trimStart().length), name[1] as string);
        cursor += part.length + 1;
      }
    }
    // Bare use of the whole object, e.g. schema.parse(process.env).
    for (const m of masked.matchAll(/\bprocess\s*\.\s*env\b(?!\s*[.[])/g)) {
      const before = masked.slice(Math.max(0, m.index - 12), m.index);
      if (/\.\.\.\s*$/.test(before) || /\benv\s*:\s*$/.test(before)) continue;
      if (/\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*$/.test(masked.slice(Math.max(0, m.index - 300), m.index))) continue;
      acc.partial.env = true;
    }
    return;
  }

  if (ext === 'py') {
    for (const m of masked.matchAll(/\b(?:os\s*\.\s*)?environ\s*\.\s*(?:get|setdefault|pop)\s*\(\s*([^),\n]*)/g)) {
      const lit = stringLiteral((m[1] as string).trim());
      if (lit !== undefined) add(m.index, lit);
      else acc.partial.env = true;
    }
    for (const m of masked.matchAll(/\bos\s*\.\s*getenv\s*\(\s*([^),\n]*)/g)) {
      const lit = stringLiteral((m[1] as string).trim());
      if (lit !== undefined) add(m.index, lit);
      else acc.partial.env = true;
    }
    for (const m of masked.matchAll(/\b(?:os\s*\.\s*)?environ\s*\[\s*([^\]\n]*)\]/g)) {
      const lit = stringLiteral((m[1] as string).trim());
      if (lit !== undefined) add(m.index, lit);
      else acc.partial.env = true;
    }
    // Pydantic settings derive names from field names: not modeled.
    if (/\bBaseSettings\b|\bpydantic_settings\b|\bdynaconf\b|\benviron\s*\.\s*Env\b|\bdecouple\b/.test(masked)) acc.partial.env = true;
    return;
  }

  if (ext === 'go') {
    for (const m of masked.matchAll(/\bos\s*\.\s*(?:Getenv|LookupEnv)\s*\(\s*([^),\n]*)/g)) {
      const lit = stringLiteral((m[1] as string).trim());
      if (lit !== undefined) add(m.index, lit);
      else acc.partial.env = true;
    }
    if (/\bviper\s*\.\s*AutomaticEnv\b|\benv\s*\.\s*Parse\b|\bcleanenv\b|\bkelseyhightower\/envconfig\b/.test(masked)) acc.partial.env = true;
    return;
  }

  if (ext === 'java' || ext === 'kt') {
    for (const m of masked.matchAll(/\bSystem\s*\.\s*getenv\s*\(\s*([^)\n]*)\)/g)) {
      const arg = (m[1] as string).trim();
      if (arg === '') acc.partial.env = true;
      else {
        const lit = stringLiteral(arg);
        if (lit !== undefined) add(m.index, lit);
        else acc.partial.env = true;
      }
    }
    if (/@ConfigurationProperties\b|@Value\s*\(/.test(masked)) acc.partial.env = true;
    return;
  }

  if (ext === 'rb') {
    for (const m of masked.matchAll(/\bENV\s*(?:\[\s*|\.\s*fetch\s*\(\s*)(['"])([^'"\n]*)\1/g)) add(m.index, m[2] as string);
    for (const m of masked.matchAll(/\bENV\s*(?:\[\s*|\.\s*fetch\s*\(\s*)(?!['"])/g)) {
      void m;
      acc.partial.env = true;
    }
  }
}

/** `.env.example`, `.env.sample`, `.env.template`, `example.env`. */
export function isEnvExampleFile(base: string): boolean {
  return /^\.env(?:\.[\w.-]+)?\.(?:example|sample|template|dist)$/.test(base) || /^(?:example|sample)\.env$/.test(base) || base === '.env.example';
}

export function indexEnvExample(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  lines.forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (m) push(acc, file, lines, i + 1, m[1] as string, 'env_example');
    else {
      // Commented-out variables such as "# PORT=3000" are documentation of a variable too.
      const c = /^\s*#\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(raw);
      if (c) push(acc, file, lines, i + 1, c[1] as string, 'env_example');
    }
  });
}

export function isComposeFile(base: string): boolean {
  return /^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/.test(base);
}

export function indexCompose(acc: IndexAcc, file: string, text: string, trees: TreeNode[]): void {
  const lines = splitLines(text);
  for (const doc of trees) {
    const services = mapGet(doc, 'services');
    if (!services || services.value.kind !== 'map') continue;
    for (const svc of services.value.entries) {
      const env = mapGet(svc.value, 'environment');
      if (!env) continue;
      if (env.value.kind === 'map') {
        for (const e of env.value.entries) push(acc, file, lines, e.line, e.key, 'compose');
      } else if (env.value.kind === 'seq') {
        for (const item of env.value.items) {
          const s = scalarString(item);
          const name = s === undefined ? undefined : /^([A-Za-z_][A-Za-z0-9_]*)(?:=|$)/.exec(s)?.[1];
          if (name) push(acc, file, lines, item.line, name, 'compose');
        }
      }
    }
  }
}

export function indexKubernetes(acc: IndexAcc, file: string, text: string, trees: TreeNode[]): boolean {
  const lines = splitLines(text);
  let found = false;
  const walk = (node: TreeNode, depth: number): void => {
    if (depth > 20) return;
    if (node.kind === 'map') {
      for (const e of node.entries) {
        if (e.key === 'env' && e.value.kind === 'seq') {
          for (const item of e.value.items) {
            const nm = mapGet(item, 'name');
            const name = scalarString(nm?.value);
            if (nm && name) {
              push(acc, file, lines, nm.line, name, 'kubernetes');
              found = true;
            }
          }
        }
        walk(e.value, depth + 1);
      }
    } else if (node.kind === 'seq') for (const i of node.items) walk(i, depth + 1);
  };
  for (const doc of trees) {
    if (mapGet(doc, 'apiVersion') && mapGet(doc, 'kind')) walk(doc, 0);
  }
  return found;
}
