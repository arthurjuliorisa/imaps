// Offline SQL contract review. Does not parse/execute PostgreSQL or prove rollback.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const read = (path) => readFileSync(resolve(__dirname, '..', path), 'utf8');
const base = read('scripts/sql/05_item_level_snapshot_functions.sql');
const patch = read('scripts/sql/production/20261021_snapshot_batch_typed_result_hotfix.sql');
const original = base.split('CREATE OR REPLACE FUNCTION upsert_items_stock_snapshot(')[1]
  .split('AS $$')[1].split('$$;')[0];
const corrected = patch.split('$wrapper$')[1];
assert.equal(createHash('md5').update(original).digest('hex'), 'f7e4c494f3577d10d5ee1b236cc744e0');
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
assert.equal(reversed, original);
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
