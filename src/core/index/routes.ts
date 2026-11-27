/**
 * Route index builders: Express, Fastify, Hono, Koa router (JS/TS), FastAPI, Flask,
 * Go (net/http, gin, echo, chi, fiber, gorilla), Spring and JAX-RS, and OpenAPI 3.
 *
 * Routes are only recorded on receivers that were created by a recognized framework
 * constructor (or are typed as one), so `axios.get('/x')` is never indexed. Mounts are
 * resolved after all files are seen. Anything dynamic sets routes coverage to partial.
 */
import type { HttpMethod } from '../model';
import { joinRoute, normalizeRoutePath } from './paths';
import { parseJsonTree, parseYamlTrees, mapGet, scalarString } from './structured';
import type { TreeNode } from './structured';
import {
  dirName,
  extOf,
  findClose,
  insideSpan,
  lineAt,
  lineStarts,
  maskCStyleComments,
  maskPython,
  resolveRelative,
  snippetOf,
  splitArgs,
  splitLines,
  stringLiteral,
  stringSpans,
  toHttpMethod,
} from './text';
import type { IndexAcc, Mount, Receiver, ReceiverKind, RouteDef } from './types';

const JS_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'];
const METHOD_NAMES = 'get|post|put|patch|delete|del|head|options|all';

interface Ctx {
  acc: IndexAcc;
  file: string;
  text: string;
  starts: number[];
  lines: string[];
  spans: Array<[number, number]>;
}

function makeCtx(acc: IndexAcc, file: string, masked: string, original: string): Ctx {
  return { acc, file, text: masked, starts: lineStarts(masked), lines: splitLines(original), spans: stringSpans(masked, { backtickStrings: !file.endsWith('.java') }) };
}

function addReceiver(ctx: Ctx, name: string, kind: ReceiverKind, framework: string, ownPrefix: string | null = ''): void {
  if (ctx.acc.receivers.some((r) => r.file === ctx.file && r.name === name)) return;
  ctx.acc.receivers.push({ file: ctx.file, name, kind, framework, ownPrefix });
}

function addRoute(ctx: Ctx, offset: number, recv: string, framework: string, method: HttpMethod | 'ANY', path: string): void {
  const line = lineAt(ctx.starts, offset);
  const def: RouteDef = { file: ctx.file, line, snippet: snippetOf(ctx.lines, line), method, path, recv, framework };
  ctx.acc.routeDefs.push(def);
}

function methodFromName(name: string): HttpMethod | 'ANY' | undefined {
  const lower = name.toLowerCase();
  if (lower === 'all' || lower === 'any') return 'ANY';
  if (lower === 'del') return 'DELETE';
  return toHttpMethod(lower);
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript
// ---------------------------------------------------------------------------

interface JsImports {
  /** local identifier -> module specifier */
  byIdent: Map<string, string>;
  specs: Set<string>;
}

function jsImports(text: string): JsImports {
  const byIdent = new Map<string, string>();
  const specs = new Set<string>();
  const names = (list: string): string[] =>
    list
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, ''))
      .filter((s) => s !== '')
      .map((s) => {
        const as = /\bas\s+([\w$]+)$/.exec(s);
        return as ? (as[1] as string) : s.replace(/[^\w$].*$/, '');
      });
  for (const m of text.matchAll(/\bimport\s+(?:type\s+)?(?:([\w$]+)|\*\s+as\s+([\w$]+))?\s*(?:,\s*)?(?:\{([^}]*)\})?\s*from\s*(['"])([^'"\n]+)\4/g)) {
    const spec = m[5] as string;
    specs.add(spec);
    for (const id of [m[1], m[2]]) if (id) byIdent.set(id, spec);
    if (m[3]) for (const id of names(m[3])) byIdent.set(id, spec);
  }
  for (const m of text.matchAll(/\bimport\s*(['"])([^'"\n]+)\1/g)) specs.add(m[2] as string);
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?require\s*\(\s*(['"])([^'"\n]+)\2\s*\)/g)) {
    byIdent.set(m[1] as string, m[3] as string);
    specs.add(m[3] as string);
  }
  for (const m of text.matchAll(/\b(?:const|let|var)\s+\{([^}]*)\}\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\2\s*\)/g)) {
    for (const id of names(m[1] as string)) byIdent.set(id, m[3] as string);
    specs.add(m[3] as string);
  }
  return { byIdent, specs };
}

function hasSpec(imports: JsImports, test: (s: string) => boolean): boolean {
  for (const s of imports.specs) if (test(s)) return true;
  return false;
}

function optionsPrefix(options: string | undefined): string | null {
  if (options === undefined) return '';
  if (!options.startsWith('{') || findClose(options, 0) !== options.length - 1) return null;
  let prefix: string | null = '';
  for (const { src } of splitArgs(options.slice(1, -1))) {
    // A later explicit key overrides a spread or computed property.
    if (/^(?:\.\.\.|\[|(?:get|set)\s+prefix\b)/.test(src)) prefix = null;
    const property = /^(?:prefix|(['"])prefix\1)\s*(?::\s*([\s\S]+))?$/.exec(src);
    if (property) prefix = stringLiteral(property[2] ?? '') ?? null;
  }
  return prefix;
}

export function indexJsRoutes(acc: IndexAcc, file: string, original: string, masked: string): void {
  const ctx = makeCtx(acc, file, masked, original);
  const text = masked;
  const imports = jsImports(text);
  const usesExpress = hasSpec(imports, (s) => s === 'express');
  const usesKoa = hasSpec(imports, (s) => s === 'koa-router' || s === '@koa/router');
  const usesFastify = hasSpec(imports, (s) => s === 'fastify' || s.startsWith('@fastify/')) || /\bFastifyInstance\b|\bFastifyPluginAsync\b/.test(text);
  const usesHono = hasSpec(imports, (s) => s === 'hono' || s.startsWith('hono/') || s.startsWith('@hono/'));
  const usesTiny = hasSpec(imports, (s) => s === '@tinyhttp/app');
  if (!(usesExpress || usesKoa || usesFastify || usesHono || usesTiny) && !/\b(?:Router|express)\s*\(/.test(text)) return;
  if (hasSpec(imports, (s) => s === '@fastify/autoload')) acc.partial.routes = true;

  const routerFramework = usesKoa ? 'koa' : 'express';

  // Receivers created in this file.
  const tinyCtor = usesTiny ? '|new\\s+App\\s*\\(' : '';
  const ctorRe = new RegExp(
    `\\b(?:const|let|var)\\s+([\\w$]+)\\s*(?::\\s*[^=;\\n]+)?=\\s*(?:await\\s+)?(express\\s*\\(\\s*\\)|new\\s+Koa\\s*\\(|(?:express\\s*\\.\\s*)?Router\\s*\\(|new\\s+(?:Koa)?Router\\s*\\(|[Ff]astify\\s*\\(|new\\s+Hono\\b${tinyCtor})`,
    'g',
  );
  for (const m of text.matchAll(ctorRe)) {
    const name = m[1] as string;
    const ctor = m[2] as string;
    const after = m.index + m[0].length;
    if (/^express\s*\(/.test(ctor) || /^new\s+App\s*\(/.test(ctor)) addReceiver(ctx, name, 'root', 'express');
    else if (/^new\s+Koa\s*\(/.test(ctor)) addReceiver(ctx, name, 'root', 'koa');
    else if (/^new\s+Hono/.test(ctor)) {
      const ctorArgs = /^\s*(?:<[^>]*>)?\s*\(/.exec(text.slice(after, after + 300));
      const ctorEnd = ctorArgs ? findClose(text, after + ctorArgs[0].length - 1) : -1;
      const basePath = ctorEnd < 0 ? null : /^\s*\.\s*basePath\s*\(/.exec(text.slice(ctorEnd + 1, ctorEnd + 301));
      let prefix: string | null = '';
      if (basePath) {
        const open = ctorEnd + basePath[0].length;
        const close = findClose(text, open);
        prefix = close < 0 ? null : stringLiteral(text.slice(open + 1, close)) ?? null;
      }
      if (prefix === null) acc.partial.routes = true;
      addReceiver(ctx, name, 'plugin', 'hono', prefix);
    } else if (/^[Ff]astify/.test(ctor)) addReceiver(ctx, name, 'root', 'fastify');
    else {
      let prefix: string | null = '';
      if (routerFramework === 'koa' && /^new\s/.test(ctor)) {
        const open = after - 1;
        const close = findClose(text, open);
        prefix = close === -1 ? null : optionsPrefix(splitArgs(text.slice(open + 1, close))[0]?.src || undefined);
        if (prefix === null) acc.partial.routes = true;
      } else if (/^new\s/.test(ctor)) {
        const open = text.indexOf('(', m.index + m[0].length - 1);
        const close = open === -1 ? -1 : findClose(text, open);
        if (close !== -1) {
          const pm = /\bprefix\s*:\s*(['"`])([^'"`]*)\1/.exec(text.slice(open, close));
          if (pm) prefix = pm[2] as string;
          else if (/\bprefix\s*:/.test(text.slice(open, close))) acc.partial.routes = true;
        }
      }
      addReceiver(ctx, name, 'sub', routerFramework, prefix);
    }
  }
  // Receivers typed by annotation or plugin signature.
  for (const m of text.matchAll(/\b([\w$]+)\s*:\s*(?:express\s*\.\s*)?(Express|Application|Router|IRouter|FastifyInstance|Hono)\b/g)) {
    const t = m[2] as string;
    if (t === 'Router' || t === 'IRouter') addReceiver(ctx, m[1] as string, 'sub', routerFramework);
    else if (t === 'FastifyInstance') addReceiver(ctx, m[1] as string, 'plugin', 'fastify');
    else if (t === 'Hono') addReceiver(ctx, m[1] as string, 'plugin', 'hono');
    else addReceiver(ctx, m[1] as string, 'plugin', 'express');
  }
  if (usesFastify) {
    for (const m of text.matchAll(/(?:\bfunction\s*[\w$]*\s*|\basync\s*)\(\s*(fastify|app|instance|server)\s*[,:)]/g)) {
      addReceiver(ctx, m[1] as string, 'plugin', 'fastify');
    }
  }

  const recvByName = (name: string): Receiver | undefined => acc.receivers.find((r) => r.file === file && r.name === name);

  // Simple route calls: recv.get('/x', ...)
  const callRe = new RegExp(`\\b([\\w$]+)\\s*\\.\\s*(${METHOD_NAMES})\\s*\\(`, 'g');
  for (const m of text.matchAll(callRe)) {
    if (insideSpan(ctx.spans, m.index)) continue;
    const recv = recvByName(m[1] as string);
    if (!recv) continue;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) {
      acc.partial.routes = true;
      continue;
    }
    const args = splitArgs(text.slice(open + 1, close), open + 1);
    const first = args[0];
    if (!first) continue;
    const method = methodFromName(m[2] as string);
    if (!method) continue;
    if (first.src.startsWith('[')) {
      const arrClose = findClose(text, first.offset);
      const items = arrClose === -1 ? [] : splitArgs(text.slice(first.offset + 1, arrClose), first.offset + 1);
      if (items.length === 0 || items.some((i) => i.literal === undefined)) acc.partial.routes = true;
      for (const it of items) if (it.literal !== undefined) addRoute(ctx, m.index, recv.name, recv.framework, method, it.literal);
      continue;
    }
    if (first.literal !== undefined) {
      if (first.literal.startsWith('/') || first.literal === '*') addRoute(ctx, m.index, recv.name, recv.framework, method, first.literal);
      // app.get('setting') style getters are not routes.
      continue;
    }
    // First argument is an identifier or expression: a dynamic registration, unless it is a handler.
    if (/^(?:async\b|function\b|\(|[\w$]+\s*=>)/.test(first.src)) continue;
    if (recv.framework === 'express' && args.length === 1) continue; // app.get(settingName)
    acc.partial.routes = true;
  }

  // Computed access: app[method]('/x')
  for (const m of text.matchAll(/\b([\w$]+)\s*\[\s*[^\]\n]+\]\s*\(/g)) {
    if (recvByName(m[1] as string)) acc.partial.routes = true;
  }

  // Express chain: router.route('/x').get(...).post(...)
  for (const m of text.matchAll(/\b([\w$]+)\s*\.\s*route\s*\(\s*(['"`])([^'"`\n]*)\2\s*\)/g)) {
    if (insideSpan(ctx.spans, m.index)) continue;
    const recv = recvByName(m[1] as string);
    if (!recv) continue;
    let pos = m.index + m[0].length;
    for (let guard = 0; guard < 20; guard++) {
      const nx = new RegExp(`^\\s*\\.\\s*(${METHOD_NAMES})\\s*\\(`).exec(text.slice(pos, pos + 120));
      if (!nx) break;
      const open = pos + nx[0].length - 1;
      const method = methodFromName(nx[1] as string);
      if (method) addRoute(ctx, pos + nx[0].indexOf(nx[1] as string), recv.name, recv.framework, method, m[3] as string);
      const close = findClose(text, open);
      if (close === -1) break;
      pos = close + 1;
    }
  }

  // Fastify: app.route({ method, url })
  for (const m of text.matchAll(/\b([\w$]+)\s*\.\s*route\s*\(\s*\{/g)) {
    if (insideSpan(ctx.spans, m.index)) continue;
    const recv = recvByName(m[1] as string);
    if (!recv) continue;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) continue;
    const body = text.slice(open, close);
    const url = /\b(?:url|path)\s*:\s*(['"`])([^'"`]*)\1/.exec(body);
    if (!url) {
      acc.partial.routes = true;
      continue;
    }
    const arr = /\bmethod\s*:\s*\[([^\]]*)\]/.exec(body);
    const one = /\bmethod\s*:\s*(['"])(\w+)\1/.exec(body);
    const methods = arr ? [...(arr[1] as string).matchAll(/['"](\w+)['"]/g)].map((x) => x[1] as string) : one ? [one[2] as string] : [];
    if (methods.length === 0) acc.partial.routes = true;
    for (const mt of methods) {
      const hm = methodFromName(mt);
      if (hm) addRoute(ctx, open + (url.index ?? 0), recv.name, recv.framework, hm, url[2] as string);
    }
  }

  // Mounts: parent.use('/p', child), parent.route('/p', child) (Hono), parent.register(plugin, { prefix })
  for (const m of text.matchAll(/\b([\w$]+)\s*\.\s*(use|route|register)\s*\(/g)) {
    if (insideSpan(ctx.spans, m.index)) continue;
    const parent = recvByName(m[1] as string);
    if (!parent) continue;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) continue;
    const args = splitArgs(text.slice(open + 1, close), open + 1);
    const kind = m[2] as string;
    let prefix: string | null = '';
    let target: string | undefined;
    if (kind === 'register') {
      target = args[0]?.src;
      prefix = optionsPrefix(args[1]?.src || undefined);
      if (prefix === null) acc.partial.routes = true;
      if (target && /^(?:async\b|function\b|\()/.test(target)) {
        if (prefix !== '') acc.partial.routes = true; // inline plugin with a prefix: routes inside are not prefixed by us
        continue;
      }
    } else if (kind === 'use') {
      const a0 = args[0];
      if (!a0) continue;
      if (a0.literal !== undefined && a0.literal.startsWith('/')) {
        prefix = a0.literal;
        target = args[1]?.src;
      } else if (a0.literal === undefined && args.length === 1) target = a0.src;
      else continue;
    } else {
      // A single argument belongs to the Express route chain handled above.
      if (args.length !== 2) continue;
      prefix = args[0]?.literal ?? null;
      if (prefix === null) {
        if (parent.framework !== 'hono') continue;
        acc.partial.routes = true;
      }
      target = args[1]?.src;
    }
    if (!target) continue;
    const t = classifyJsTarget(target);
    if (!t) continue;
    const mount: Mount = { file, parent: parent.name, prefix };
    if (t.kind === 'ident') {
      if (recvByName(t.name)) mount.local = t.name;
      else {
        const spec = imports.byIdent.get(t.name);
        if (!spec || !spec.startsWith('.')) continue;
        mount.importSpec = spec;
      }
    } else {
      if (!t.spec.startsWith('.')) continue;
      mount.importSpec = t.spec;
    }
    acc.mounts.push(mount);
  }
}

function classifyJsTarget(src: string): { kind: 'ident'; name: string } | { kind: 'spec'; spec: string } | undefined {
  const s = src.trim();
  let m = /^([\w$]+)(?:\s*\.\s*(?:default|routes\s*\(\s*\)|router))?$/.exec(s);
  if (m) return { kind: 'ident', name: m[1] as string };
  m = /^(?:await\s+)?require\s*\(\s*(['"])([^'"]+)\1\s*\)(?:\s*\.\s*(?:default|router))?$/.exec(s);
  if (m) return { kind: 'spec', spec: m[2] as string };
  m = /^(?:await\s+)?import\s*\(\s*(['"])([^'"]+)\1\s*\)$/.exec(s);
  if (m) return { kind: 'spec', spec: m[2] as string };
  return undefined;
}

// ---------------------------------------------------------------------------
// Python: FastAPI, Flask
// ---------------------------------------------------------------------------

export function indexPythonRoutes(acc: IndexAcc, file: string, original: string, masked: string): void {
  const ctx = makeCtx(acc, file, masked, original);
  const text = masked;
  if (!/\b(?:fastapi|flask|FastAPI|Flask|APIRouter|Blueprint)\b/.test(text)) return;
  if (/\burlpatterns\b|\badd_url_rule\s*\(|\badd_resource\s*\(|\badd_api_route\s*\(|\.mount\s*\(/.test(text)) acc.partial.routes = true;

  const recvByName = (name: string): Receiver | undefined => acc.receivers.find((r) => r.file === file && r.name === name);

  for (const m of text.matchAll(/^[ \t]*([A-Za-z_]\w*)\s*(?::\s*[^=\n]+)?=\s*(FastAPI|Flask|APIRouter|Blueprint)\s*\(/gm)) {
    const name = m[1] as string;
    const ctor = m[2] as string;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    const args = close === -1 ? [] : splitArgs(text.slice(open + 1, close), open + 1);
    let prefix = '';
    const key = ctor === 'APIRouter' ? 'prefix' : ctor === 'Blueprint' ? 'url_prefix' : undefined;
    if (key) {
      const kw = args.find((a) => new RegExp(`^${key}\\s*=`).test(a.src));
      if (kw) {
        const lit = stringLiteral(kw.src.replace(new RegExp(`^${key}\\s*=\\s*`), ''));
        if (lit === undefined) acc.partial.routes = true;
        else prefix = lit;
      }
    }
    if (ctor === 'FastAPI' || ctor === 'Flask') {
      const root = ctor === 'FastAPI' ? args.find((a) => /^root_path\s*=/.test(a.src)) : undefined;
      if (root) acc.partial.routes = true;
      addReceiver(ctx, name, 'root', ctor === 'FastAPI' ? 'fastapi' : 'flask');
    } else addReceiver(ctx, name, 'sub', ctor === 'APIRouter' ? 'fastapi' : 'flask', prefix);
  }

  // Decorators: @app.get("/x"), @bp.route("/x", methods=[...])
  for (const m of text.matchAll(/^[ \t]*@\s*([A-Za-z_]\w*)\s*\.\s*(get|post|put|patch|delete|head|options|route|api_route)\s*\(/gm)) {
    const recv = recvByName(m[1] as string);
    if (!recv) continue;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) {
      acc.partial.routes = true;
      continue;
    }
    const args = splitArgs(text.slice(open + 1, close), open + 1);
    const pathArg = args.find((a, i) => i === 0 && !/^\w+\s*=/.test(a.src)) ?? args.find((a) => /^(?:path|rule)\s*=/.test(a.src));
    if (!pathArg) {
      acc.partial.routes = true;
      continue;
    }
    const lit = pathArg.literal ?? stringLiteral(pathArg.src.replace(/^\w+\s*=\s*/, ''));
    if (lit === undefined) {
      acc.partial.routes = true;
      continue;
    }
    const verb = m[2] as string;
    let methods: Array<HttpMethod | 'ANY'> = [];
    if (verb === 'route' || verb === 'api_route') {
      const mk = args.find((a) => /^methods\s*=/.test(a.src));
      if (mk) {
        const found = [...mk.src.matchAll(/(['"])(\w+)\1/g)].map((x) => methodFromName(x[2] as string)).filter((x): x is HttpMethod | 'ANY' => x !== undefined);
        if (found.length === 0) acc.partial.routes = true;
        methods = found;
      } else methods = verb === 'route' ? ['GET'] : [];
      if (methods.length === 0 && !mk) acc.partial.routes = true;
    } else {
      const hm = methodFromName(verb);
      if (hm) methods = [hm];
    }
    for (const mt of methods) addRoute(ctx, pathArg.offset, recv.name, recv.framework, mt, lit);
  }

  // Imports: from a.b import x as y / import a.b as y
  const pyImports = new Map<string, { module: string; name: string }>();
  for (const m of text.matchAll(/^[ \t]*from\s+([.\w]+)\s+import\s+(\([^)]*\)|[^\n]+)/gm)) {
    const list = (m[2] as string).replace(/[()]/g, ' ');
    for (const part of list.split(',')) {
      const mm = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part.replace(/\s+/g, ' '));
      if (mm) pyImports.set((mm[2] ?? mm[1]) as string, { module: m[1] as string, name: mm[1] as string });
    }
  }
  for (const m of text.matchAll(/^[ \t]*import\s+([.\w]+)\s+as\s+([A-Za-z_]\w*)/gm)) {
    pyImports.set(m[2] as string, { module: m[1] as string, name: '' });
  }

  // Mounts: parent.include_router(x, prefix=...), app.register_blueprint(bp, url_prefix=...)
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*(include_router|register_blueprint)\s*\(/g)) {
    const parent = recvByName(m[1] as string);
    if (!parent) continue;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) continue;
    const args = splitArgs(text.slice(open + 1, close), open + 1);
    const targetSrc = args[0]?.src ?? '';
    const base = /^([A-Za-z_]\w*)(?:\s*\.\s*\w+)?$/.exec(targetSrc);
    if (!base) {
      acc.partial.routes = true;
      continue;
    }
    const key = m[2] === 'include_router' ? 'prefix' : 'url_prefix';
    let prefix = '';
    const kw = args.find((a) => new RegExp(`^${key}\\s*=`).test(a.src));
    if (kw) {
      const lit = stringLiteral(kw.src.replace(new RegExp(`^${key}\\s*=\\s*`), ''));
      if (lit === undefined) {
        acc.partial.routes = true;
        continue;
      }
      prefix = lit;
    }
    const ident = base[1] as string;
    const mount: Mount = { file, parent: parent.name, prefix };
    if (recvByName(ident)) mount.local = ident;
    else {
      const imp = pyImports.get(ident);
      if (!imp) {
        acc.partial.routes = true;
        continue;
      }
      mount.pyImport = imp;
    }
    acc.mounts.push(mount);
  }
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

const GO_ROOT_CTORS = /(?:gin\s*\.\s*(?:Default|New)|echo\s*\.\s*New|chi\s*\.\s*NewRouter|chi\s*\.\s*NewMux|mux\s*\.\s*NewRouter|http\s*\.\s*NewServeMux|fiber\s*\.\s*New)\s*\(/;

export function indexGoRoutes(acc: IndexAcc, file: string, original: string, masked: string): void {
  const ctx = makeCtx(acc, file, masked, original);
  const text = masked;
  if (!/\b(?:net\/http|gin-gonic|labstack\/echo|go-chi|gorilla\/mux|gofiber)/.test(original)) return;
  const recvNames = new Set<string>();
  if (/"net\/http"/.test(original)) {
    addReceiver(ctx, 'http', 'root', 'net/http');
    recvNames.add('http');
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\w+)\\s*:?=\\s*&?${GO_ROOT_CTORS.source}`, 'g'))) {
    addReceiver(ctx, m[1] as string, 'root', 'go');
    recvNames.add(m[1] as string);
  }
  for (const m of text.matchAll(/\b(\w+)\s+\*?(gin\.Engine|echo\.Echo|chi\.Mux|fiber\.App|mux\.Router|http\.ServeMux)\b/g)) {
    addReceiver(ctx, m[1] as string, 'plugin', 'go');
    recvNames.add(m[1] as string);
  }
  for (const m of text.matchAll(/\b(\w+)\s+\*?(gin\.RouterGroup|echo\.Group|chi\.Router|fiber\.Router)\b/g)) {
    addReceiver(ctx, m[1] as string, 'sub', 'go');
    recvNames.add(m[1] as string);
  }
  // Groups: v1 := r.Group("/v1")
  for (const m of text.matchAll(/\b(\w+)\s*:?=\s*(\w+)\s*\.\s*Group\s*\(\s*"([^"]*)"/g)) {
    if (!recvNames.has(m[2] as string)) continue;
    addReceiver(ctx, m[1] as string, 'sub', 'go');
    recvNames.add(m[1] as string);
    ctx.acc.mounts.push({ file, parent: m[2] as string, prefix: m[3] as string, local: m[1] as string });
  }
  if (/\.\s*(?:Route|Mount)\s*\(\s*"[^"]*"\s*,\s*func\b/.test(text)) {
    acc.taintedRouteFiles.add(file);
    acc.partial.routes = true;
  }
  const verbs = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Get|Post|Put|Patch|Delete|Head|Options|Any|All|Handle|HandleFunc';
  for (const m of text.matchAll(new RegExp(`\\b(\\w+)\\s*\\.\\s*(${verbs})\\s*\\(`, 'g'))) {
    if (insideSpan(ctx.spans, m.index)) continue;
    const recv = m[1] as string;
    if (!recvNames.has(recv)) continue;
    const verb = m[2] as string;
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) continue;
    const args = splitArgs(text.slice(open + 1, close), open + 1);
    const verbMethod = methodFromName(verb);
    const isHandle = verb === 'Handle' || verb === 'HandleFunc';
    let method: HttpMethod | 'ANY' | undefined = verbMethod;
    let pathArg = args[0];
    if (isHandle && recv !== 'http' && args.length >= 2 && args[0]?.literal !== undefined && toHttpMethod(args[0].literal) && args[1]?.literal !== undefined) {
      method = toHttpMethod(args[0].literal);
      pathArg = args[1];
    }
    if (!pathArg) continue;
    if (pathArg.literal === undefined && !/^`[^`]*`$/.test(pathArg.src)) {
      if (!/^(?:func\b|\w+$)/.test(pathArg.src) || args.length >= 2) acc.partial.routes = true;
      continue;
    }
    let route = pathArg.literal ?? pathArg.src.slice(1, -1);
    if (isHandle) {
      const pat = /^(?:([A-Z]+)\s+)?(?:[\w.-]*)(\/.*)$/.exec(route);
      if (!pat) continue;
      if (pat[1]) method = toHttpMethod(pat[1]);
      else if (method === undefined) method = 'ANY';
      route = pat[2] as string;
      if (recv !== 'http') {
        // gorilla: HandleFunc(path, h).Methods("GET")
        const tail = /^\s*\.\s*Methods\s*\(([^)]*)\)/.exec(text.slice(close + 1, close + 200));
        if (tail) {
          for (const mm of (tail[1] as string).matchAll(/"(\w+)"/g)) {
            const hm = toHttpMethod(mm[1] as string);
            if (hm) addRoute(ctx, m.index, recv, 'go', hm, route);
          }
          continue;
        }
      }
    }
    if (method === undefined) continue;
    addRoute(ctx, m.index, recv, 'go', method, route.replace(/\{([^}/]*?)\.\.\.\}/g, '{$1}'));
  }
}

// ---------------------------------------------------------------------------
// Java: Spring MVC and JAX-RS
// ---------------------------------------------------------------------------

export function indexJavaRoutes(acc: IndexAcc, file: string, original: string, masked: string): void {
  const ctx = makeCtx(acc, file, masked, original);
  const text = masked;
  if (/\bRouterFunction\b|\bRouterFunctions\b/.test(text)) acc.partial.routes = true;
  const classPos = [...text.matchAll(/\b(?:class|interface)\s+\w+/g)].map((m) => m.index);
  if (classPos.length === 0) return;
  let classPrefix = '';
  const firstClass = classPos[0] as number;

  const annoRe = /@(Get|Post|Put|Patch|Delete|Request)Mapping\b(?:\s*\(([^)]*)\))?/g;
  const pathsIn = (args: string | undefined): string[] | undefined => {
    if (args === undefined || args.trim() === '') return [''];
    const named = /\b(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*"|[\w.]+)/.exec(args);
    const bare = /^\s*(\{[^}]*\}|"[^"]*")/.exec(args);
    const spec = named?.[1] ?? bare?.[1];
    if (spec === undefined) return [''];
    const lits = [...spec.matchAll(/"([^"]*)"/g)].map((x) => x[1] as string);
    if (lits.length === 0 || /[A-Za-z_]\w*\s*[+,)]|\+/.test(spec.replace(/"[^"]*"/g, ''))) return undefined;
    return lits;
  };

  for (const m of text.matchAll(annoRe)) {
    const kind = m[1] as string;
    const args = m[2];
    const paths = pathsIn(args);
    const isClassLevel = kind === 'Request' && /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+|abstract\s+|final\s+)*(?:class|interface)\b/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 400));
    if (paths === undefined) {
      acc.partial.routes = true;
      continue;
    }
    if (isClassLevel) {
      classPrefix = paths[0] ?? '';
      continue;
    }
    if (m.index < firstClass) continue;
    let methods: Array<HttpMethod | 'ANY'>;
    if (kind === 'Request') {
      const found = [...(args ?? '').matchAll(/RequestMethod\s*\.\s*(\w+)/g)].map((x) => methodFromName(x[1] as string)).filter((x): x is HttpMethod | 'ANY' => x !== undefined);
      methods = found.length > 0 ? found : ['ANY'];
    } else methods = [methodFromName(kind) as HttpMethod];
    for (const p of paths) for (const mt of methods) addRoute(ctx, m.index, '', 'spring', mt, joinRoute(classPrefix, p));
  }

  // JAX-RS
  let jaxClassPath = '';
  const cp = /@Path\s*\(\s*"([^"]*)"\s*\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+|abstract\s+|final\s+)*(?:class|interface)\b/.exec(text);
  if (cp) jaxClassPath = cp[1] as string;
  for (const m of text.matchAll(/@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b(?!\w)/g)) {
    const idx = m.index;
    const before = Math.max(text.lastIndexOf(';', idx), text.lastIndexOf('{', idx), text.lastIndexOf('}', idx));
    let endSig = idx;
    while (endSig < text.length) {
      const ch = text[endSig];
      if (ch === '{' || ch === ';') break;
      if (ch === '(') {
        const c = findClose(text, endSig);
        if (c === -1) break;
        endSig = c;
      }
      endSig++;
    }
    const window = text.slice(before + 1, endSig);
    const pm = /@Path\s*\(\s*"([^"]*)"\s*\)/.exec(window);
    const method = toHttpMethod(m[1] as string);
    if (method) addRoute(ctx, idx, '', 'jaxrs', method, joinRoute(jaxClassPath, pm?.[1] ?? ''));
  }
  for (const m of text.matchAll(/@WebServlet\s*\(\s*(?:urlPatterns\s*=\s*|value\s*=\s*)?\{?\s*"([^"]+)"/g)) {
    addRoute(ctx, m.index, '', 'servlet', 'ANY', m[1] as string);
  }
}

// ---------------------------------------------------------------------------
// OpenAPI 3 (and Swagger 2)
// ---------------------------------------------------------------------------

export function looksLikeOpenApi(trees: TreeNode[]): TreeNode | undefined {
  return trees.find((t) => t.kind === 'map' && (mapGet(t, 'openapi') !== undefined || mapGet(t, 'swagger') !== undefined) && mapGet(t, 'paths') !== undefined);
}

export function indexOpenApi(acc: IndexAcc, file: string, original: string, doc: TreeNode): void {
  const lines = splitLines(original);
  const paths = mapGet(doc, 'paths');
  if (!paths || paths.value.kind !== 'map') return;
  for (const p of paths.value.entries) {
    if (!p.key.startsWith('/')) continue;
    if (p.value.kind !== 'map') continue;
    let any = false;
    for (const op of p.value.entries) {
      const method = toHttpMethod(op.key);
      if (!method) continue;
      any = true;
      pushRoute(acc, { file, line: op.line, snippet: snippetOf(lines, op.line), method, path: normalizeRoutePath(p.key), framework: 'openapi' });
    }
    if (!any && mapGet(p.value, '$ref')) acc.partial.routes = true;
  }
}

function pushRoute(acc: IndexAcc, e: { file: string; line: number; snippet: string; method: HttpMethod | 'ANY'; path: string; framework: string }): void {
  acc.routes.push(e);
}

export function openApiFromText(path: string, text: string): TreeNode | undefined {
  const ext = extOf(path);
  const trees = ext === 'json' ? [parseJsonTree(text)].filter((t): t is TreeNode => t !== undefined) : parseYamlTrees(text) ?? [];
  return looksLikeOpenApi(trees);
}

export { scalarString };

// ---------------------------------------------------------------------------
// Resolution of mounts and prefixes
// ---------------------------------------------------------------------------

function resolveJsSpec(from: string, spec: string, paths: Set<string>): string | undefined {
  const base = resolveRelative(from, spec);
  if (base === undefined) return undefined;
  const stripped = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
  for (const b of new Set([base, stripped])) {
    if (paths.has(b)) return b;
    for (const e of JS_EXT) if (paths.has(`${b}.${e}`)) return `${b}.${e}`;
    for (const e of JS_EXT) if (paths.has(`${b}/index.${e}`)) return `${b}/index.${e}`;
  }
  return undefined;
}

function resolvePyModule(from: string, module: string, paths: Set<string>): string | undefined {
  let rel: string;
  const dots = /^\.+/.exec(module)?.[0].length ?? 0;
  if (dots > 0) {
    let dir = dirName(from);
    for (let i = 1; i < dots; i++) dir = dirName(dir);
    const rest = module.slice(dots).replace(/\./g, '/');
    rel = [dir, rest].filter((x) => x !== '').join('/');
  } else rel = module.replace(/\./g, '/');
  if (rel === '') return undefined;
  for (const c of [`${rel}.py`, `${rel}/__init__.py`]) if (paths.has(c)) return c;
  if (dots === 0) {
    for (const p of paths) if (p.endsWith(`/${rel}.py`) || p.endsWith(`/${rel}/__init__.py`)) return p;
  }
  return undefined;
}

function targetFileOf(m: Mount, paths: Set<string>): string | undefined {
  if (m.importSpec) return resolveJsSpec(m.file, m.importSpec, paths);
  if (m.pyImport) {
    const { module, name } = m.pyImport;
    if (name !== '') {
      const sub = resolvePyModule(m.file, `${module}${module.endsWith('.') ? '' : '.'}${name}`, paths);
      if (sub) return sub;
    }
    return resolvePyModule(m.file, module, paths);
  }
  return undefined;
}

export function resolveRoutes(acc: IndexAcc): void {
  const byKey = new Map<string, Receiver>();
  for (const r of acc.receivers) byKey.set(`${r.file}\u0000${r.name}`, r);
  const mountTargets = acc.mounts.map((m) => ({ m, file: targetFileOf(m, acc.paths) }));
  const memo = new Map<string, string[] | undefined>();

  const prefixesFor = (r: Receiver, depth: number, seen: Set<string>): string[] | undefined => {
    const { ownPrefix } = r;
    if (ownPrefix === null) return undefined;
    const key = `${r.file}\u0000${r.name}`;
    if (memo.has(key)) return memo.get(key);
    if (depth > 8 || seen.has(key)) return undefined;
    seen.add(key);
    let result: string[] | undefined;
    if (r.kind === 'root') result = [ownPrefix];
    else {
      const incoming = mountTargets.filter(({ m, file }) => (m.local !== undefined ? m.file === r.file && m.local === r.name : file === r.file));
      if (incoming.length === 0) result = r.kind === 'plugin' ? [ownPrefix] : undefined;
      else {
        const out: string[] = [];
        for (const { m } of incoming) {
          if (m.prefix === null) continue;
          const parent = byKey.get(`${m.file}\u0000${m.parent}`);
          if (!parent) continue;
          const pp = prefixesFor(parent, depth + 1, new Set(seen));
          if (!pp) continue;
          for (const p of pp) out.push(joinRoute(joinRoute(p, m.prefix), ownPrefix === '' ? '/' : ownPrefix));
        }
        result = out.length > 0 ? out : undefined;
      }
    }
    memo.set(key, result);
    return result;
  };

  const seenRoute = new Set<string>();
  for (const d of acc.routeDefs) {
    if (acc.taintedRouteFiles.has(d.file)) continue;
    let prefixes: string[] | undefined;
    if (d.recv === '') prefixes = [''];
    else {
      const r = byKey.get(`${d.file}\u0000${d.recv}`);
      prefixes = r ? prefixesFor(r, 0, new Set()) : undefined;
    }
    if (!prefixes) {
      acc.partial.routes = true;
      continue;
    }
    for (const p of prefixes) {
      const path = joinRoute(p, d.path);
      const k = `${d.method} ${path} ${d.file}:${d.line}`;
      if (seenRoute.has(k)) continue;
      seenRoute.add(k);
      acc.routes.push({ file: d.file, line: d.line, snippet: d.snippet, method: d.method, path, framework: d.framework });
    }
  }
}

export function maskFor(path: string, text: string): string {
  const ext = extOf(path);
  if (ext === 'py') return maskPython(text);
  if (ext === 'go' || ext === 'java') return maskCStyleComments(text, { backtickStrings: ext === 'go' });
  return maskCStyleComments(text);
}
