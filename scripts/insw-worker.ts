import { ACTIVATION_BLOCKERS, startupDecision } from '../lib/insw-worker/safety';

// Dedicated process entrypoint; no application imports, .env loading, Prisma,
// timers, claims or transport. Even explicit opt-in fails closed in this release.
export function main(env: NodeJS.ProcessEnv = process.env): number {
  if (startupDecision(env) === 'DISABLED') {
    process.stdout.write('INSW worker disabled (default). No resources opened.\n');
    return 0;
  }
  process.stderr.write(`INSW worker NOT READY FOR ACTIVATION: ${ACTIVATION_BLOCKERS.join(', ')}\n`);
  return 78;
}

if (require.main === module) process.exitCode = main();
