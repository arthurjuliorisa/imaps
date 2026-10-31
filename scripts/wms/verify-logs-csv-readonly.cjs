// Read-only host acceptance probe. No dotenv, schema changes, fixtures or writes.
// Run with node --require tsx/cjs; never print URLs, rows or driver diagnostics.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { PrismaClient, Prisma } = require('@prisma/client');
async function main() {
  if (process.env.WMS_CSV_VERIFY_ACK !== 'local-nonproduction-readonly') throw new Error('TARGET_ACK_REQUIRED');
  const url = new URL(process.env.WMS_CSV_VERIFY_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.hash || [...url.searchParams.keys()].some(key => !['sslmode'].includes(key)) ||
      !process.env.WMS_CSV_VERIFY_DB || decodeURIComponent(url.pathname.slice(1)) !== process.env.WMS_CSV_VERIFY_DB) throw new Error('LOCAL_TARGET_REQUIRED');
  const companyCode = process.env.WMS_CSV_VERIFY_COMPANY;
  if (!/^-?\d+$/.test(companyCode || '') || !Number.isInteger(Number(companyCode)) || Number(companyCode) < -2147483648 || Number(companyCode) > 2147483647) throw new Error('COMPANY_REQUIRED');
  url.searchParams.set('connection_limit', '1'); url.searchParams.set('connect_timeout', '3');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      const [identity] = await tx.$queryRaw`SELECT current_database() AS name, current_setting('transaction_read_only') AS readonly`;
      assert.equal(identity.name, process.env.WMS_CSV_VERIFY_DB); assert.equal(identity.readonly, 'on');
      let firstQuery;
      const load = Module._load;
      Module._load = function(request) {
        if (request === '@/lib/prisma') return { prisma: { $queryRaw: query => { firstQuery ??= query; return tx.$queryRaw(query); } } };
        return load.apply(this, arguments);
      };
      let createWmsCsvPostgresqlSource;
      try { ({ createWmsCsvPostgresqlSource } = require('../../lib/wms-logs-csv-postgresql.ts')); }
      finally { Module._load = load; }
      const { buildWmsLogWhere } = require('../../lib/wms-log-filters.ts');
      const { encodeWmsCsvRow } = require('../../lib/wms-logs-csv.ts');
      const where = buildWmsLogWhere(new URLSearchParams(process.env.WMS_CSV_VERIFY_FILTERS || ''), { user: { role: 'USER', companyCode } }, true);
      const select = { created_at: true, action: true, transmission_status: true, wms_id: true,
        company_code: true, error_type: true, item_count: true, expires_at: true };
      const count = await tx.wms_transmission_logs.count({ where });
      const expectedFirst = await tx.wms_transmission_logs.findMany({ where, select, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 2000 });
      const source = createWmsCsvPostgresqlSource(where);
      let rows = 0, refusals = 0, calls = 0;
      for (;;) {
        const batch = await source(Math.min(2000, 100001 - rows)); calls++;
        if (calls === 1) assert.deepEqual(batch, expectedFirst);
        if (!batch.length) break;
        for (const row of batch) {
          rows++;
          if (rows <= 100000) {
            try { encodeWmsCsvRow(row, rows); }
            catch (error) { if (error.code === 'UNSAFE_VALUE') refusals++; else throw error; }
          }
        }
        if (rows === 100001) break;
      }
      assert.equal(rows, Math.min(count, 100001));
      const plan = await tx.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) ${firstQuery}`);
      const nodes = [];
      function visit(node) { nodes.push({ type: node['Node Type'], index: node['Index Name'] || null }); for (const child of node.Plans || []) visit(child); }
      visit(plan[0]['QUERY PLAN'][0].Plan);
      console.log(JSON.stringify({ readonly: true, filterCount: count, traversed: rows, sourceCalls: calls,
        first2000Parity: true, countParityThrough100001: true, unsafeValueRefusals: refusals,
        overflow: count > 100000, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, planNodes: nodes }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000, maxWait: 3000 });
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('WMS read-only verification failed; verify target, filters, grants, schema and query budgets locally. Details withheld.'); process.exitCode = 1; });
