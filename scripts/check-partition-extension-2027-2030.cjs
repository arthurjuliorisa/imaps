#!/usr/bin/env node
// Offline only: built-ins, no environment/config imports, DB clients or processes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');
const prefix = 'scripts/sql/production/';
const driver = read(prefix + '20261122_partition_extension_2027_2030.sql');
const group = read(prefix + 'partition_extension_2027_2030/group.sql');
const verify = read(prefix + '20261122_partition_extension_2027_2030_verify.sql');
const bootstrap = read('scripts/sql/01_setup_partitions.sql');
const mapping = {
  incoming_goods: 'incoming_date', material_usages: 'transaction_date',
  wip_balances: 'stock_date', production_outputs: 'transaction_date',
  outgoing_goods: 'outgoing_date', adjustments: 'transaction_date',
  stock_daily_snapshot: 'snapshot_date',
};
const uncomment = s => s.replace(/--[^\n]*/g, '');
const ddl = uncomment(driver + '\n' + group);
assert(!/\b(DROP|TRUNCATE|CASCADE|DELETE|UPDATE|INSERT|ALTER|GRANT|REVOKE)\b/i.test(ddl));
assert(!/CREATE\s+OR\s+REPLACE|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|ensure_\w*|calculate_\w*/i.test(ddl));
assert(!/202[456]|203[1-9]/.test(ddl), 'DDL must not target historical or later years');
assert.match(group, /FOR y IN 2027\.\.2030 LOOP/);
assert.match(group, /FOR q IN 1\.\.\(CASE WHEN company = 'none' THEN 1 ELSE 4 END\) LOOP/);
assert.match(group, /lo := make_date\(y, \(q - 1\) \* 3 \+ 1, 1\)/);
assert.match(group, /hi := \(lo \+ CASE WHEN company = 'none' THEN interval '1 year' ELSE interval '3 months' END\)::date/);
assert.match(group, /leaf := parent_name \|\| '_' \|\| y \|\| CASE WHEN company = 'none' THEN '' ELSE '_q' \|\| q END/);
assert.equal((group.match(/CREATE TABLE public\.%I PARTITION OF public\.%I FOR VALUES FROM \(%L\) TO \(%L\)/g) || []).length, 1);
for (const token of ['pg_inherits', 'relispartition', 'relkind', 'relowner', 'pg_get_expr',
  'pg_get_partkeydef', 'partdefid', 'indisvalid', 'indisready', 'indislive', 'conparentid',
  'convalidated', 'attnotnull', 'RAISE EXCEPTION', "lock_timeout = '3s'", "statement_timeout = '60s'"])
  assert(group.includes(token), `Missing DDL safeguard: ${token}`);
assert.match(group, /BEGIN;[\s\S]*DO \$group\$[\s\S]*COMMIT;/);
assert.match(group, /LOCK TABLE ONLY public\.%I IN ACCESS EXCLUSIVE MODE/);
assert.match(driver, /\\set ON_ERROR_STOP on/);
assert.match(driver, /\\set AUTOCOMMIT on/);
assert.match(group, /\\gexec/);
assert.match(verify, /BEGIN READ ONLY;/);
assert(!/\b(DO|CALL|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/i.test(uncomment(verify)));
assert(!/ensure_\w*|upsert_\w*|calculate_\w*/i.test(verify));
for (const token of ['generate_series(2025, 2030)', 'generate_series(2024, 2030)',
  'generate_series(1, 4)', 'INDEX_ATTACHMENT', 'CONSTRAINT', 'COLUMN_OR_NOT_NULL',
  'UNEXPECTED_ATTACHED_RELATION', 'verified_target_count', 'HISTORY']) assert(verify.includes(token));

const vars = {}, groups = [], manifest = [];
for (const line of uncomment(driver).split('\n').map(s => s.trim()).filter(Boolean)) {
  let m;
  if ((m = line.match(/^\\set (\w+) (\w+)$/))) vars[m[1]] = m[2];
  else if (line === '\\ir partition_extension_2027_2030/group.sql') {
    assert.equal(mapping[vars.root], vars.date_key);
    assert(['1310', '1370', '1380', 'none'].includes(vars.company));
    const snapshot = vars.root === 'stock_daily_snapshot';
    assert.equal(snapshot, vars.company === 'none');
    const parent = snapshot ? vars.root : `${vars.root}_${vars.company}`;
    groups.push(parent);
    for (let year = 2027; year <= 2030; year++) {
      for (let quarter = 1; quarter <= (snapshot ? 1 : 4); quarter++) {
        const lo = new Date(Date.UTC(year, (quarter - 1) * 3, 1)).toISOString().slice(0, 10);
        const hi = new Date(Date.UTC(year, snapshot ? 12 : quarter * 3, 1)).toISOString().slice(0, 10);
        const name = `${parent}_${year}${snapshot ? '' : `_q${quarter}`}`;
        manifest.push({ name, parent, lo, hi });
        // Compare against established historical naming/attachment/bounds, shifted two years.
        if (year === 2027 || year === 2028) {
          const oldYear = year - 2;
          const oldName = name.replace(`_${year}`, `_${oldYear}`);
          const oldLo = lo.replace(String(year), String(oldYear));
          const oldHi = `${Number(hi.slice(0, 4)) - 2}${hi.slice(4)}`;
          assert(bootstrap.includes(`CREATE TABLE ${oldName} PARTITION OF ${parent}\n    FOR VALUES FROM ('${oldLo}') TO ('${oldHi}');`), oldName);
        }
      }
    }
  } else assert.fail(`Unrecognized driver line: ${line}`);
}
assert.equal(groups.length, 19);
assert.equal(new Set(groups).size, 19);
assert.equal(manifest.length, 292);
assert.equal(new Set(manifest.map(r => r.name)).size, 292);
assert.equal(manifest.filter(r => r.name.startsWith('stock_daily_snapshot_')).length, 4);
for (const parent of groups) {
  const ranges = manifest.filter(r => r.parent === parent);
  assert.equal(ranges[0].lo, '2027-01-01');
  assert.equal(ranges.at(-1).hi, '2031-01-01');
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i - 1].hi, ranges[i].lo);
  // Independent daily oracle checks every day, including leap day and quarter/year boundaries.
  for (let d = Date.UTC(2027, 0, 1); d < Date.UTC(2031, 0, 1); d += 86400000) {
    const day = new Date(d).toISOString().slice(0, 10);
    assert.equal(ranges.filter(r => r.lo <= day && day < r.hi).length, 1, `${parent}: ${day}`);
  }
  assert.equal(ranges.filter(r => r.lo <= '2028-02-29' && '2028-02-29' < r.hi).length, 1);
  assert.equal(ranges.filter(r => r.lo <= '2031-01-01' && '2031-01-01' < r.hi).length, 0);
}
if (process.argv.includes('--manifest')) {
  for (const r of manifest) console.log(JSON.stringify(r));
} else console.log('PASS offline: 19 groups, 288 transaction + 4 snapshot leaves; naming/bounds match bootstrap; all 1,461 days/group covered once, leap day included; 2031 excluded; DDL/read-only guards checked. SQL was not executed or database-parsed.');
