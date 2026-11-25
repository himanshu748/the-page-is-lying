import { describe, expect, it } from 'vitest';
import type { NormalizedClaim } from '../../../src/core/model.js';
import { codeBlock, doc, fromAdf, fromText } from './helpers.js';

const key = (keyPath: string, file?: string): NormalizedClaim =>
  file === undefined ? { type: 'config_key', keyPath } : { type: 'config_key', keyPath, file };

describe('config_key extraction', () => {
  it.each<[string, string, NormalizedClaim[]]>([
    ['bare dotted key in code span', 'Set `server.port` to 8080.', [key('server.port')]],
    ['key with file in the same span', 'Set `retry.maxAttempts in config/default.yaml`', [key('retry.maxAttempts', 'config/default.yaml')]],
    ['key in span, file in prose', 'Set `retry.maxAttempts` in config/default.yaml.', [key('retry.maxAttempts', 'config/default.yaml')]],
    ['key in prose next to a config file', 'The retry.maxAttempts key in `config/default.yaml` is 3.', [key('retry.maxAttempts', 'config/default.yaml')]],
    ['key in a fence after the file reference', 'In `config/prod.yaml`:\n\n```yaml\nserver.port: 8080\n```', [key('server.port', 'config/prod.yaml')]],
    ['key in a paragraph before the file reference', 'Set `server.port` to 8080.\n\nThe setting lives in `config/prod.yaml`.', [key('server.port', 'config/prod.yaml')]],
    ['nearest file wins', 'In `a.yaml` and later `b.yaml` set `xx.yy`', [key('xx.yy', 'b.yaml')]],
    ['hyphens and underscores', 'Use `feature_flags.new-ui`', [key('feature_flags.new-ui')]],
    ['deep key', 'Use `a1.b2.c3.d4`', [key('a1.b2.c3.d4')]],
  ])('%s', (_name, input, expected) => {
    expect(fromText(input, 'config_key')).toEqual(expected);
  });

  it.each<[string, string]>([
    ['prose key without file', 'The retry.maxAttempts value is 3.'],
    ['file extension', 'Edit `package.json`'],
    ['host name', 'Open `api.example.com`'],
    ['product name', 'Install `Node.js`'],
    ['js global', 'Call `console.log`'],
    ['function call', 'Call `server.start()`'],
    ['abbreviation', 'e.g. this'],
    ['version number', 'Use `1.2.3`'],
    ['key far from file', `retry.maxAttempts ${'x '.repeat(80)} in config/default.yaml`],
    ['code span with extra words', 'Use `see server.port here`'],
    ['inside url', 'Open https://docs.example.org/server.port/x'],
  ])('negative: %s', (_name, input) => {
    expect(fromText(input, 'config_key')).toEqual([]);
  });

  it('assignment lines in code blocks', () => {
    const adf = doc(codeBlock('server.port: 8080\nlogging.level = debug\nconsole.log(x)'));
    expect(fromAdf(adf, 'config_key')).toEqual([key('server.port'), key('logging.level')]);
  });
});
