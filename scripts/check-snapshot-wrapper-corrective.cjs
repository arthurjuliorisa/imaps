// Offline SQL contract review. Does not parse/execute PostgreSQL or prove rollback.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const read = (path) => readFileSync(resolve(__dirname, '..', path), 'utf8');
const base = read('scripts/sql/05_item_level_snapshot_functions.sql');
const patch = read('scripts/sql/production/20261021_snapshot_batch_typed_result_hotfix.sql');
const canonical = base.split('CREATE OR REPLACE FUNCTION upsert_items_stock_snapshot(')[1]
  .split('AS $$')[1].split('$$;')[0];
const corrected = patch.split('$wrapper$')[1];
const canonicalHeader = base.split('CREATE OR REPLACE FUNCTION upsert_items_stock_snapshot(')[1]
  .split('AS $$')[0].replace(/\s+/g, ' ').trim();
assert.equal(canonicalHeader, 'p_company_code INTEGER, p_items JSONB, p_snapshot_date DATE ) RETURNS TABLE( item_code VARCHAR(50), opening_balance NUMERIC(15,3), closing_balance NUMERIC(15,3), status VARCHAR(20), message TEXT ) LANGUAGE plpgsql',
  'legacy input signature and five-column output must remain unchanged');
assert.equal(canonical, corrected, 'canonical and historical proven correction must match exactly');
assert(patch.includes("IF md5(v_source) <> 'f7e4c494f3577d10d5ee1b236cc744e0'"));
assert(patch.includes('IF v_source = v_corrected_source THEN'));
assert(patch.includes('EXECUTE replace(v_definition, v_source, v_corrected_source)'));
assert(patch.includes("(to_jsonb(p) - 'prosrc') = v_metadata"));
assert(patch.includes('pg_get_functiondef(p.oid)'));
assert(!/\b(?:DROP FUNCTION|ALTER FUNCTION|GRANT|REVOKE)\b/i.test(patch));
// Exact reverse functional diff: everything outside result extraction, finite
// validation and explicit return casts must still equal the original wrapper.
const finiteGuard = `            IF v_opening_balance IS NULL OR v_closing_balance IS NULL
               OR v_opening_balance::TEXT IN ('NaN', 'Infinity', '-Infinity')
               OR v_closing_balance::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
                RAISE EXCEPTION 'Snapshot balances must be finite and non-null';
            END IF;

`;
assert(corrected.includes(finiteGuard));
const reversed = corrected
  .replace('    v_opening_balance NUMERIC;\n    v_closing_balance NUMERIC;', '    v_result RECORD;')
  .replace('SELECT s.opening_balance, s.closing_balance\n            INTO STRICT v_opening_balance, v_closing_balance', 'SELECT * INTO v_result')
  .replace('            ) AS s;', '            );')
  .replace(finiteGuard, '')
  .replaceAll('v_item_code::VARCHAR(50),', 'v_item_code,')
  .replace('v_opening_balance::NUMERIC(15,3)', '(v_result)."opening_balance"')
  .replace('v_closing_balance::NUMERIC(15,3)', '(v_result)."closing_balance"');
assert.equal(createHash('md5').update(reversed).digest('hex'), 'f7e4c494f3577d10d5ee1b236cc744e0', 'reverse functional diff must match proven original body');
assert.equal(createHash('md5').update(corrected).digest('hex'), '53efa7ba5b948a030233ffb81513d7d7');
const itemBlock = corrected.split('        BEGIN')[1].split('        END;')[0];
assert(itemBlock.indexOf('INTO STRICT') < itemBlock.indexOf('RETURN QUERY'));
assert(itemBlock.indexOf(finiteGuard) < itemBlock.indexOf('RETURN QUERY'));
assert(itemBlock.includes('EXCEPTION WHEN OTHERS THEN'));
assert.equal((corrected.match(/RETURN QUERY SELECT/g) || []).length, 2);
assert(!corrected.includes('v_result'));
assert(!/v_(?:opening|closing)_balance\s*(?:<|<=|>|>=)\s*0/.test(corrected));
assert.equal((corrected.match(/v_item_code::VARCHAR\(50\),/g) || []).length, 2);
assert(corrected.includes("'SUCCESS'::VARCHAR(20)"));
assert(corrected.includes("'ERROR'::VARCHAR(20)"));
assert(read('lib/services/beginning-balance-snapshot.service.ts').includes('const SNAPSHOT_BATCH_SIZE = 1000;'));
console.log('PASS: exact wrapper-only functional diff, qualified STRICT extraction, finite guard placement, typed five-column returns, unchanged exception contract, metadata/idempotence guards, batch size 1000');
console.log('PostgreSQL runtime cases (zero/multiple rows, NULL/NaN/infinity, subtransaction rollback) remain user-run acceptance gates.');

// Exercise the actual runner with mocked process/filesystem boundaries. No psql,
// dotenv, environment credentials, DB clients or connections are used.
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const commands = [];
const runner = ts.transpileModule(read('scripts/deploy-sql.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(runner, {
  exports: {}, __dirname: path.resolve(__dirname),
  console: { log() {}, error(message) { throw new Error(message); } },
  process: { env: { DATABASE_URL: 'mock://offline' }, exit(code) { throw new Error(`exit ${code}`); } },
  require(name) {
    if (name === 'child_process') return { execSync(command) { commands.push(command); } };
    if (name === 'fs') return { existsSync: require('node:fs').existsSync };
    if (name === 'path') return path;
    if (name === 'dotenv') return { config() {} };
    throw new Error(`Unexpected runner dependency ${name}`);
  },
});
const files = commands.filter(command => command !== 'psql --version').map(command => {
  const match = command.match(/-f "([^"\n]+)"/);
  assert(match, `Unrecognized SQL invocation: ${command}`);
  return path.relative(path.resolve(__dirname, 'sql'), match[1]);
});
assert.deepEqual(files, ['01_setup_partitions.sql', '03_functions.sql', '04_create_views.sql',
  '05_item_level_snapshot_functions.sql', '05_permissions.sql']);
let installed;
for (const file of files) {
  const sql = read(`scripts/sql/${file}`);
  const wrappers = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (?:public\.)?upsert_items_stock_snapshot\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
  for (const wrapper of wrappers) installed = wrapper[1];
}
assert.equal(installed, corrected, 'last deployed wrapper must be the correction');
const description = read('scripts/sql/production/20260525_stock_snapshot_description_hotfix.sql');
assert(!/CREATE OR REPLACE FUNCTION (?:public\.)?upsert_items_stock_snapshot\(/.test(description));
const production = read('scripts/sql/production/20261022_snapshot_batch_typed_result_hotfix.sql');
assert.equal(production.split('$wrapper$')[1], corrected);
for (const guard of ["current_database() <> 'imaps_db'", "session_user <> current_user",
  "current_setting('imaps_patch.approved_metadata_md5')", "current_setting('imaps_patch.approved_item_definition_md5')",
  "IF md5(v_source) <> 'f7e4c494f3577d10d5ee1b236cc744e0'", "(to_jsonb(p) - 'prosrc') = v_metadata"]) assert(production.includes(guard), guard);
assert(production.indexOf('reviewed preflight') < production.indexOf('IF v_source = v_corrected_source THEN'));
assert(!production.includes('inet_server_addr()'));
assert(!/\b(?:DROP FUNCTION|ALTER FUNCTION|GRANT|REVOKE)\b/i.test(production));
assert(patch.includes("current_database() <> 'imaps_prod_repro'"), 'historical clone guard retained');
const scripts = JSON.parse(read('package.json')).scripts;
assert.equal(scripts['deploy:sql'], 'tsx scripts/deploy-sql.ts');
assert(scripts['build:local'].includes('tsx scripts/deploy-sql.ts'));
assert(!Object.values(scripts).some(script => script.includes('20261022_snapshot')));
console.log('PASS: mocked actual deployment order ends with canonical corrected wrapper; description hotfix leaves wrapper intact; Production artifact is separate, guarded and never automatic.');
