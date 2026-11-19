#!/usr/bin/env node
import { Command } from 'commander';
import { markRefunded } from './store';

const program = new Command();

program.name('payments').description('Payments service command line').version('2.3.0');

program
  .command('refund <paymentId>')
  .description('Refund a captured payment')
  .option('--confirm', 'confirm that the refund should be issued')
  .option('--reason <text>', 'reason recorded with the refund')
  .action((paymentId: string, options: { confirm?: boolean; reason?: string }) => {
    if (!options.confirm) {
      console.error('Refusing to refund without --confirm');
      process.exitCode = 1;
      return;
    }
    const payment = markRefunded(paymentId, options.reason);
    if (!payment) {
      console.error(`Payment ${paymentId} not found`);
      process.exitCode = 1;
      return;
    }
    console.log(`Refunded ${payment.id}`);
  });

program.parse();
