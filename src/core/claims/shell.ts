import type { Segment } from './context.js';

/**
 * A tiny shell-like tokenizer for code spans and code block lines. It never executes
 * or expands anything: it only splits a line into words and commands.
 */

export interface Token {
  /** Word without surrounding quotes. */
  value: string;
  /** Offsets in the block text, quotes included. */
  start: number;
  end: number;
  quoted: boolean;
}

export interface Command {
  tokens: Token[];
}

export const MAX_TOKENS_PER_SEGMENT = 200;

/** Splits one code line into commands separated by `|`, `||`, `&&` and `;`. A `#` token starts a comment. */
export function tokenizeSegment(segment: Segment): Command[] {
  const text = segment.text;
  const commands: Command[] = [];
  let current: Token[] = [];
  let count = 0;
  const flush = (): void => {
    if (current.length > 0) commands.push({ tokens: current });
    current = [];
  };
  let i = 0;
  while (i < text.length && count < MAX_TOKENS_PER_SEGMENT) {
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '|' || ch === ';') {
      flush();
      i++;
      continue;
    }
    if (ch === '&' && text.charAt(i + 1) === '&') {
      flush();
      i += 2;
      continue;
    }
    if (ch === '#') break;
    const begin = i;
    let value = '';
    let quoted = false;
    let quote = '';
    while (i < text.length) {
      const c = text.charAt(i);
      if (quote !== '') {
        if (c === quote) quote = '';
        else value += c;
      } else if (c === '"' || c === "'") {
        quote = c;
        quoted = true;
      } else if (/\s/.test(c) || c === '|' || c === ';' || (c === '&' && text.charAt(i + 1) === '&')) {
        break;
      } else {
        value += c;
      }
      i++;
    }
    current.push({ value, start: segment.start + begin, end: segment.start + i, quoted });
    count++;
  }
  flush();
  return commands;
}

/** Drops a leading prompt (`$`, `>`, `%`) and leading `NAME=value` assignments. */
export function stripPrefix(tokens: Token[]): Token[] {
  let index = 0;
  const first = tokens[0];
  if (first && !first.quoted && (first.value === '$' || first.value === '>' || first.value === '%')) index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || token.quoted || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value)) break;
    index++;
  }
  return tokens.slice(index);
}
