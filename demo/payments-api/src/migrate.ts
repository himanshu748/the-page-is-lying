import { loadConfig } from './config';

// Placeholder migration runner for the demo: prints the statements it would run.
const statements = [
  'CREATE TABLE IF NOT EXISTS payments (id text PRIMARY KEY, amount integer NOT NULL, currency text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL)',
];

function main(): void {
  const { databaseUrl } = loadConfig();
  console.log(`Migrating ${databaseUrl.replace(/:\/\/.*@/, '://***@')}`);
  for (const sql of statements) console.log(sql);
}

main();
