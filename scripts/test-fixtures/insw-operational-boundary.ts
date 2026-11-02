import { PrismaClient } from '@prisma/client';
import { isolatedDatabaseUrl } from '../../lib/insw-worker/isolated-worker';
import { acquireOperationalOwnership, admitNext } from '../../lib/insw-worker/operational.repository';

const db = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl(process.env) } } });
let token: string;
process.on('message', async message => {
  try {
    if (message === 'acquire') {
      token = await acquireOperationalOwnership(db); process.send?.({ event: 'owned', data: { token } });
    }
    if (message === 'admit') {
      await admitNext(db, token); process.send?.({ event: 'admitted' });
    }
  } catch { process.send?.({ event: 'blocked' }); }
});
process.send?.({ event: 'ready' });
