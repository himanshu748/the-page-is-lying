import { describe, expect, it } from 'vitest';
import type { NormalizedClaim } from '../../../src/core/model.js';
import { codeBlock, doc, fromAdf, fromText } from './helpers.js';

const cli = (program: string, subcommands: string[], flags: string[] = []): NormalizedClaim => ({ type: 'cli', program, subcommands, flags });

describe('cli extraction', () => {
  it.each<[string, string, NormalizedClaim[]]>([
    ['subcommand and long flag', 'Run `payments refund <paymentId> --force`', [cli('payments', ['refund'], ['--force'])]],
    ['flag value is not a subcommand', 'Run `ledgerctl reconcile --since 24h`', [cli('ledgerctl', ['reconcile'], ['--since'])]],
    ['--x=v becomes --x', 'Run `tool sync --region=eu --dry-run`', [cli('tool', ['sync'], ['--region', '--dry-run'])]],
    ['short flags', 'Run `tool build -s -v`', [cli('tool', ['build'], ['-s', '-v'])]],
    ['nested subcommands', 'Run `tool db migrate up`', [cli('tool', ['db', 'migrate', 'up'])]],
    ['flags only', 'Run `tool --version`', [cli('tool', [], ['--version'])]],
    ['duplicate flags collapse', 'Run `tool x --a --a`', [cli('tool', ['x'], ['--a'])]],
    ['prompt stripped', 'Run `$ tool deploy`', [cli('tool', ['deploy'])]],
    ['env prefix skipped', 'Run `LOG=1 tool deploy`', [cli('tool', ['deploy'])]],
    ['npm run', 'Run `npm run db:migrate`', [cli('npm', ['run', 'db:migrate'])]],
    ['npm run with args ignored', 'Run `npm run build -- --watch`', [cli('npm', ['run', 'build'])]],
    ['npm run with flag first', 'Run `npm run --silent build`', [cli('npm', ['run', 'build'])]],
    ['npm test is a script', 'Run `npm test`', [cli('npm', ['run', 'test'])]],
    ['yarn script', 'Run `yarn db:migrate`', [cli('yarn', ['run', 'db:migrate'])]],
    ['yarn run', 'Run `yarn run lint`', [cli('yarn', ['run', 'lint'])]],
    ['pnpm run', 'Run `pnpm run build`', [cli('pnpm', ['run', 'build'])]],
    ['make target', 'Run `make seed`', [cli('make', ['seed'])]],
    ['make targets and vars', 'Run `make -j4 build test ENV=prod`', [cli('make', ['build', 'test'])]],
    ['pipeline yields both commands', 'Run `tool export --json | other-tool filter --id`', [cli('tool', ['export'], ['--json']), cli('other-tool', ['filter'], ['--id'])]],
    ['comment dropped', 'Run `tool deploy # then wait`', [cli('tool', ['deploy'])]],
    ['quoted values are not subcommands', 'Run `tool say "hello there" --loud`', [cli('tool', ['say'], ['--loud'])]],
    ['-- ends options', 'Run `tool run -- --not-mine`', [cli('tool', ['run'])]],
  ])('%s', (_name, input, expected) => {
    expect(fromText(input, 'cli')).toEqual(expected);
  });

  it.each<[string, string]>([
    ['prose is not a command', 'You can run payments refund --force by hand.'],
    ['external tool: git', 'Run `git commit -m x`'],
    ['external tool: docker', 'Run `docker compose up -d`'],
    ['external tool: kubectl', 'Run `kubectl get pods --all-namespaces`'],
    ['external tool: node', 'Run `node scripts/seed.js --fast`'],
    ['curl goes to http', 'Run `curl -X POST https://h.io/v1/a`'],
    ['npm install', 'Run `npm install express`'],
    ['yarn install', 'Run `yarn install`'],
    ['npm run without script', 'Run `npm run`'],
    ['program alone', 'Run `ledgerctl`'],
    ['make alone', 'Run `make`'],
    ['uppercase program', 'Run `POST /v1/a`'],
    ['path program', 'Run `./bin/tool deploy`'],
    ['placeholders only', 'Run `tool <name>`'],
  ])('negative: %s', (_name, input) => {
    expect(fromText(input, 'cli')).toEqual([]);
  });

  it('code block lines, prompts, continuation and chained commands', () => {
    const adf = doc(codeBlock('$ payments refund pay_1 --reason "dup" --confirm\nnpm run db:migrate && ledgerctl reconcile --since 24h\n# comment only\nls -la'));
    expect(fromAdf(adf, 'cli')).toEqual([
      cli('payments', ['refund'], ['--reason', '--confirm']),
      cli('npm', ['run', 'db:migrate']),
      cli('ledgerctl', ['reconcile'], ['--since']),
    ]);
  });

  it('caps tokens per line without throwing', () => {
    const flags = Array.from({ length: 500 }, (_v, i) => `--f${String(i)}`).join(' ');
    const claims = fromText(`\`tool run ${flags}\``, 'cli');
    expect(claims).toHaveLength(1);
  });
});
