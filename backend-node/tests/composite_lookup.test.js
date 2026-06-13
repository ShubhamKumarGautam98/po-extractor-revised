const assert = require('assert');
const { applyLookup } = require('../services/transformer');

// =====================================================================
// Simple test runner - matches the style used in extractor.test.js
// =====================================================================
let passed = 0;
let failed = 0;

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`  PASS: ${name}`);
      passed++;
    })
    .catch(err => {
      console.log(`  FAIL: ${name}`);
      console.log(`        ${err.message}`);
      failed++;
    });
}

// =====================================================================
// Composite-key lookups (e.g. "Style No|Season" -> "AD627488|AW26")
//
// No row in transformation_data.csv currently uses this pattern, but the
// spec describes it explicitly as a rule type the transformer must support
// ("some rows match on more than one fact ... only apply the row when ALL
// key parts match"). These tests use a synthetic rule set - matching the
// spec's own worked example - to verify applyLookup() handles it correctly.
// =====================================================================

const COMPOSITE_RULES = [
  {
    rule_type: 'item_default',
    source_label: 'Style No|Season',
    source_value: 'AD627488|AW26',
    target_field: 'items.factory_id',
    target_value: 'HANFEI',
    notes: 'Composite-key example from the spec'
  },
  {
    rule_type: 'item_default',
    source_label: 'Style No|Season',
    source_value: 'OTHER123|SS27',
    target_field: 'items.factory_id',
    target_value: 'WRONG',
    notes: 'A different composite rule that should NOT match'
  }
];

async function run() {
  console.log('\nComposite-key lookup tests');
  console.log('='.repeat(40));

  await test('composite key matches when all parts match', async () => {
    const factsByLabel = { 'style no': 'AD627488', 'season': 'AW26' };
    const result = applyLookup('item_default', '', COMPOSITE_RULES, factsByLabel);
    assert.strictEqual(result.factory_id, 'HANFEI');
  });

  await test('composite key does not match when one part differs', async () => {
    const factsByLabel = { 'style no': 'AD627488', 'season': 'SS27' };
    const result = applyLookup('item_default', '', COMPOSITE_RULES, factsByLabel);
    assert.deepStrictEqual(result, {});
  });

  await test('composite key matching is case-insensitive', async () => {
    const factsByLabel = { 'style no': 'ad627488', 'season': 'aw26' };
    const result = applyLookup('item_default', '', COMPOSITE_RULES, factsByLabel);
    assert.strictEqual(result.factory_id, 'HANFEI');
  });

  await test('single-key lookups are unaffected by factsByLabel (regression)', async () => {
    const singleKeyRules = [
      { rule_type: 'division_lookup', source_label: 'Customer', source_value: 'BRIGHT', target_field: 'header.div_code', target_value: 'BKD', notes: '' }
    ];
    const factsByLabel = { 'style no': 'AD627488', 'season': 'AW26' };
    const result = applyLookup('division_lookup', 'BRIGHT', singleKeyRules, factsByLabel);
    assert.strictEqual(result.div_code, 'BKD');
  });

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40));

  if (failed > 0) {
    process.exit(1);
  }
}

run();
