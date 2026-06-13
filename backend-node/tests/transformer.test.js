// ── Transformer Unit Tests ──────────────────────────────────────────────────
// Run with: node tests/transformer.test.js

const fs = require('fs');
const path = require('path');

// ── Minimal test framework ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${description}`);
    console.log(`    → ${err.message}`);
    failed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected "${expected}" but got "${actual}"`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) {
        throw new Error(`Expected ${b} but got ${a}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    },
    toContain(item) {
      if (!actual.includes(item)) {
        throw new Error(`Expected array to contain "${item}"`);
      }
    },
    toHaveLength(length) {
      if (actual.length !== length) {
        throw new Error(`Expected length ${length} but got ${actual.length}`);
      }
    }
  };
}

// ── Load transformer functions inline ──────────────────────────────────────
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] || '';
      return obj;
    }, {});
  });
}

function loadRules() {
  const csvPath = path.join(__dirname, '../config/transformation_data.csv');
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  return parseCSV(csvText);
}

function detectCustomer(facts, rules) {
  const detectionRules = rules.filter(r => r.rule_type === 'source_detection');
  const brand = (facts.document_brand || '').toLowerCase();
  for (const rule of detectionRules) {
    if (brand.includes(rule.source_value.toLowerCase())) return rule.target_value;
  }
  return null;
}

function applyLookup(ruleType, sourceValue, rules) {
  const result = {};
  rules
    .filter(r =>
      r.rule_type === ruleType &&
      r.source_value.toLowerCase() === (sourceValue || '').toLowerCase()
    )
    .forEach(rule => {
      result[rule.target_field.split('.').pop()] = rule.target_value;
    });
  return result;
}

function applyHeaderDefaults(rules) {
  const result = {};
  rules
    .filter(r => r.rule_type === 'header_default')
    .forEach(rule => {
      result[rule.target_field.replace('header.', '')] = rule.target_value;
    });
  return result;
}

// ── Load rules once ─────────────────────────────────────────────────────────
let rules;
try {
  rules = loadRules();
} catch (err) {
  console.error('Could not load transformation_data.csv:', err.message);
  console.error('Make sure you run this from the project root folder.');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n── CSV Loading ──────────────────────────────────────────');

test('CSV loads and returns an array', () => {
  expect(Array.isArray(rules)).toBeTruthy();
});

test('CSV has more than 10 rules', () => {
  expect(rules.length > 10).toBeTruthy();
});

test('CSV rows have required columns', () => {
  const row = rules[0];
  expect(Object.keys(row)).toContain('rule_type');
  expect(Object.keys(row)).toContain('source_value');
  expect(Object.keys(row)).toContain('target_field');
  expect(Object.keys(row)).toContain('target_value');
});

// ── Source Detection ──────────────────────────────────────────────────────
console.log('\n── Source detection ─────────────────────────────────────');

test('detects BrightKids customer', () => {
  const facts = { document_brand: 'BrightKids' };
  expect(detectCustomer(facts, rules)).toBe('BRIGHT');
});

test('detects ThreadHaven customer', () => {
  const facts = { document_brand: 'ThreadHaven' };
  expect(detectCustomer(facts, rules)).toBe('GEORGE');
});

test('detects Raj International customer', () => {
  const facts = { document_brand: 'Raj International Sourcing' };
  expect(detectCustomer(facts, rules)).toBe('RAJ');
});

test('returns null for unknown brand', () => {
  const facts = { document_brand: 'Unknown Brand XYZ' };
  expect(detectCustomer(facts, rules)).toBe(null);
});

test('detection is case insensitive', () => {
  const facts = { document_brand: 'brightkids' };
  expect(detectCustomer(facts, rules)).toBe('BRIGHT');
});

// ── Header Defaults ───────────────────────────────────────────────────────
console.log('\n── Header defaults ──────────────────────────────────────');

test('header default action is NEW', () => {
  const defaults = applyHeaderDefaults(rules);
  expect(defaults.action).toBe('NEW');
});

// ── Division Lookup ───────────────────────────────────────────────────────
console.log('\n── Division lookup ──────────────────────────────────────');

test('BRIGHT maps to division BKD', () => {
  const result = applyLookup('division_lookup', 'BRIGHT', rules);
  expect(result.div_code).toBe('BKD');
});

test('GEORGE maps to division KAE', () => {
  const result = applyLookup('division_lookup', 'GEORGE', rules);
  expect(result.div_code).toBe('KAE');
});

test('RAJ maps to division RJI', () => {
  const result = applyLookup('division_lookup', 'RAJ', rules);
  expect(result.div_code).toBe('RJI');
});

// ── Vendor Lookup ─────────────────────────────────────────────────────────
console.log('\n── Vendor lookup ────────────────────────────────────────');

test('vendor 07821490 maps to BKDS01', () => {
  const result = applyLookup('vendor_lookup', '07821490', rules);
  expect(result.vendor_code).toBe('BKDS01');
});

test('vendor 07821490 has USD currency', () => {
  const result = applyLookup('vendor_lookup', '07821490', rules);
  expect(result.vendor_currency).toBe('USD');
});

test('vendor 07821490 has FOB incoterm', () => {
  const result = applyLookup('vendor_lookup', '07821490', rules);
  expect(result.vendor_inc_code).toBe('FOB');
});

test('supplier 1007679 maps to RAJLTD', () => {
  const result = applyLookup('vendor_lookup', '1007679', rules);
  expect(result.vendor_code).toBe('RAJLTD');
});

test('vendor 05344742 maps to THVN42', () => {
  const result = applyLookup('vendor_lookup', '05344742', rules);
  expect(result.vendor_code).toBe('THVN42');
});

test('vendor 05344746 maps to THVN46', () => {
  const result = applyLookup('vendor_lookup', '05344746', rules);
  expect(result.vendor_code).toBe('THVN46');
});

// ── Country Lookup ────────────────────────────────────────────────────────
console.log('\n── Country lookup ───────────────────────────────────────');

test('Bangladesh maps to BGD', () => {
  const result = applyLookup('country_lookup', 'Bangladesh', rules);
  expect(result.country_of_origin).toBe('BGD');
});

test('China maps to CHN', () => {
  const result = applyLookup('country_lookup', 'China', rules);
  expect(result.country_of_origin).toBe('CHN');
});

// ── Port Lookup ───────────────────────────────────────────────────────────
console.log('\n── Port lookup ──────────────────────────────────────────');

test('CHITTAGONG maps to CGP', () => {
  const result = applyLookup('port_lookup', 'CHITTAGONG', rules);
  expect(result.port_of_loading).toBe('CGP');
});

test('SHANDONG-QINGDAO maps to TAO', () => {
  const result = applyLookup('port_lookup', 'SHANDONG-QINGDAO', rules);
  expect(result.port_of_loading).toBe('TAO');
});

test('Chittagong - Bangladesh lading port maps to CGP', () => {
  const result = applyLookup('port_lookup', 'Chittagong - Bangladesh', rules);
  expect(result.port_of_loading).toBe('CGP');
});

// ── Destination Lookup ────────────────────────────────────────────────────
console.log('\n── Destination lookup ───────────────────────────────────');

test('United Kingdom maps to SOU discharge port', () => {
  const result = applyLookup('destination_lookup', 'United Kingdom', rules);
  expect(result.port_of_discharge).toBe('SOU');
});

test('United Kingdom maps to UKG final destination', () => {
  const result = applyLookup('destination_lookup', 'United Kingdom', rules);
  expect(result.final_destination).toBe('UKG');
});

// ── Season Lookup ─────────────────────────────────────────────────────────
console.log('\n── Season lookup ────────────────────────────────────────');

test('AW26 stays AW26', () => {
  const result = applyLookup('season_lookup', 'AW26', rules);
  expect(result.season).toBe('AW26');
});

test('SS27 stays SS27', () => {
  const result = applyLookup('season_lookup', 'SS27', rules);
  expect(result.season).toBe('SS27');
});

test('AW (Raj edge case) maps to AW26', () => {
  const result = applyLookup('season_lookup', 'AW', rules);
  expect(result.season).toBe('AW26');
});

// ── Incoterm Lookup ───────────────────────────────────────────────────────
console.log('\n── Incoterm lookup ──────────────────────────────────────');

test('FOB maps to FREE ON BOARD text', () => {
  const result = applyLookup('incoterm_lookup', 'FOB', rules);
  expect(result.incoterm_text).toBe('FREE ON BOARD');
});

test('FOB code is preserved', () => {
  const result = applyLookup('incoterm_lookup', 'FOB', rules);
  expect(result.incoterm_code).toBe('FOB');
});

// ── Factory Lookup ────────────────────────────────────────────────────────
console.log('\n── Factory lookup ───────────────────────────────────────');

test('factory 41098223 maps to FCTBD1', () => {
  const result = applyLookup('factory_lookup', '41098223', rules);
  expect(result.factory_id).toBe('FCTBD1');
});

test('factory 36229061 maps to FCTCN1', () => {
  const result = applyLookup('factory_lookup', '36229061', rules);
  expect(result.factory_id).toBe('FCTCN1');
});

test('factory 36229609 maps to FCTCN2', () => {
  const result = applyLookup('factory_lookup', '36229609', rules);
  expect(result.factory_id).toBe('FCTCN2');
});

// ── Unknown lookups return empty ──────────────────────────────────────────
console.log('\n── Edge cases ───────────────────────────────────────────');

test('unknown vendor returns empty object', () => {
  const result = applyLookup('vendor_lookup', '99999999', rules);
  expect(Object.keys(result).length).toBe(0);
});

test('unknown country returns empty object', () => {
  const result = applyLookup('country_lookup', 'Mars', rules);
  expect(Object.keys(result).length).toBe(0);
});

test('empty source value returns empty object', () => {
  const result = applyLookup('vendor_lookup', '', rules);
  expect(Object.keys(result).length).toBe(0);
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────');
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
console.log('─────────────────────────────────────────────────────────\n');

if (failed > 0) process.exit(1);