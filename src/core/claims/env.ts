import { inCode, type BlockContext, type Candidate } from './context';

const NAME_RE = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g;
const MAX_NAME_LENGTH = 64;

/** Constant-like names that are not environment variables unless an explicit cue says so. */
const STOP_NAMES: ReadonlySet<string> = new Set([
  'HTTP_OK',
  'HTTP_GET',
  'HTTP_POST',
  'HTTP_PUT',
  'HTTP_PATCH',
  'HTTP_DELETE',
  'NOT_FOUND',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'STATUS_OK',
  'MAX_INT',
  'MIN_INT',
  'MAX_VALUE',
  'MIN_VALUE',
  'NULL_POINTER',
  'TCP_IP',
  'JSON_RPC',
  'NOT_NULL',
  'DEFAULT_VALUE',
  'TRUE_FALSE',
  'READ_ONLY',
  'WRITE_ONLY',
  'READ_WRITE',
  'ON_OFF',
  'YES_NO',
]);

const STOP_PATTERN = /^(?:HTTP|ISO|UTF|SHA|MD|RFC|TLS|SSL|HTTP2)_?\d/;

function isStopped(name: string): boolean {
  return STOP_NAMES.has(name) || STOP_PATTERN.test(name);
}

/** Cue that makes a name an env var on its own, even in prose or when it is a stop-listed constant. */
function explicitCue(text: string, start: number, end: number, code: boolean): boolean {
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 2);
  if (/(?:\$\{?|\bexport\s+|process\.env\.|\bprocess\.env\[\s*['"]|\bos\.environ\[\s*['"]|\bos\.environ\.get\(\s*['"]|\bos\.getenv\(\s*['"]|\bimport\.meta\.env\.|\bENV\[\s*['"])$/.test(before)) {
    return true;
  }
  return code && after.startsWith('=') && !after.startsWith('==') && /(?:^|[\s`])$/.test(before);
}

export function extractEnv(ctx: BlockContext): Candidate[] {
  const out: Candidate[] = [];
  const text = ctx.text;
  NAME_RE.lastIndex = 0;
  for (let m = NAME_RE.exec(text); m !== null; m = NAME_RE.exec(text)) {
    const name = m[0];
    const start = m.index;
    const end = start + name.length;
    if (name.length > MAX_NAME_LENGTH) continue;
    // Whole-token check: no adjacent identifier characters or trailing underscore pieces.
    if (/[A-Za-z0-9_]/.test(text.charAt(start - 1)) && start > 0) continue;
    if (/[A-Za-z0-9_]/.test(text.charAt(end))) continue;

    const high = inCode(ctx, start, end);
    const cue = explicitCue(text, start, end, high);
    let accepted = cue;
    if (!accepted && high && !isStopped(name)) {
      const segment = ctx.segments.find((s) => start >= s.start && end <= s.end);
      accepted = segment !== undefined && segment.start === start && segment.end === end;
    }
    if (!accepted) continue;
    out.push({ start, end, high, normalized: { type: 'env_var', name } });
  }
  return out;
}
