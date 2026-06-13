const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractFromPDF, detectLayout, extractBrightKids, extractGeorge, extractRaj } = require('../services/extractor');

// =====================================================================
// Simple test runner - no external framework needed
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

function loadFixture(filename) {
  const filePath = path.join(__dirname, 'fixtures', filename);
  return fs.readFileSync(filePath);
}

async function run() {
  console.log('\n=== detectLayout() ===');

  await test('detects BrightKids from document text', async () => {
    const text = 'BrightKids\nPurchase Order 2450187\n...';
    assert.strictEqual(detectLayout(text), 'brightkids');
  });

  await test('detects Raj from "International Sourcing" text', async () => {
    const text = 'Page 1 of 3\nInternational Sourcing\nOrder Create Date...';
    assert.strictEqual(detectLayout(text), 'raj');
  });

  await test('detects George/ThreadHaven from Purchase Order Number + Split A', async () => {
    const text = 'Purchase Order 1208545\nDelivery 1 Split A\nShipment Date: 08 Aug 2026 -\n...Purchase Order Number 1208545...';
    assert.strictEqual(detectLayout(text), 'george');
  });

  await test('returns "unknown" for unrecognised layouts', async () => {
    const text = 'Some random document with no matching markers';
    assert.strictEqual(detectLayout(text), 'unknown');
  });

  console.log('\n=== extractBrightKids() ===');

  await test('extracts header fields from brightkids_2450187.pdf', async () => {
    const buffer = loadFixture('brightkids_2450187.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractBrightKids(result.text);

    assert.strictEqual(facts.document_brand, 'BrightKids');
    assert.strictEqual(facts.po_number, '2450187');
    assert.strictEqual(facts.vendor_no, '07821490');
    assert.strictEqual(facts.factory_no, '41098223');
    assert.strictEqual(facts.season, 'SS27');
    assert.strictEqual(facts.style_no, '4320-51892-6103-007');
    assert.strictEqual(facts.colour, 'FOREST GREEN');
    assert.strictEqual(facts.country_of_origin, 'Bangladesh');
    assert.strictEqual(facts.currency, 'USD');
  });

  await test('extracts both deliveries with 13 items each', async () => {
    const buffer = loadFixture('brightkids_2450187.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractBrightKids(result.text);

    assert.strictEqual(facts.deliveries.length, 2);
    assert.strictEqual(facts.deliveries[0].items.length, 13);
    assert.strictEqual(facts.deliveries[1].items.length, 13);
  });

  await test('correctly splits order_qty and cartons for first item', async () => {
    const buffer = loadFixture('brightkids_2450187.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractBrightKids(result.text);

    const firstItem = facts.deliveries[0].items[0];
    assert.strictEqual(firstItem.size, '3-4Y');
    assert.strictEqual(firstItem.cost_price, '5.85');
    assert.strictEqual(firstItem.order_qty, '95');
    assert.strictEqual(firstItem.cartons, '19');
  });

  console.log('\n=== extractGeorge() ===');

  await test('extracts header fields and 3 deliveries from george_1208545.pdf', async () => {
    const buffer = loadFixture('george_1208545.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractGeorge(result.text);

    assert.strictEqual(facts.po_number, '1208545');
    assert.strictEqual(facts.vendor_no, '05344742');
    assert.strictEqual(facts.factory_no, '36229061');
    assert.strictEqual(facts.season, 'AW26');
    assert.strictEqual(facts.style_no, '5810-30338-4877-003');
    assert.strictEqual(facts.colour, 'LILAC');
    assert.strictEqual(facts.country_of_origin, 'China');

    assert.strictEqual(facts.deliveries.length, 3);
    const totalItems = facts.deliveries.reduce((sum, d) => sum + d.items.length, 0);
    assert.strictEqual(totalItems, 33);
  });

  await test('extracts prepack PO george_1208546.pdf with 10 items and prepacks', async () => {
    const buffer = loadFixture('george_1208546.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractGeorge(result.text);

    assert.strictEqual(facts.po_number, '1208546');
    assert.strictEqual(facts.vendor_no, '05344746');
    assert.strictEqual(facts.factory_no, '36229609');

    assert.strictEqual(facts.deliveries.length, 1);
    assert.strictEqual(facts.deliveries[0].items.length, 10);

    assert.strictEqual(facts.prepacks.length, 1);
    assert.strictEqual(facts.prepacks[0].sizes.length, 10);
  });

  console.log('\n=== extractRaj() ===');

  await test('extracts header fields from raj_461-38901.pdf', async () => {
    const buffer = loadFixture('raj_461-38901.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractRaj(result.text);

    assert.strictEqual(facts.po_number, '461-38901');
    assert.strictEqual(facts.supplier_no, '1007679');
    assert.strictEqual(facts.destination_location, 'United Kingdom');
    assert.strictEqual(facts.order_date, '14-APR-2026');
    assert.strictEqual(facts.style_no, 'JL627409');
    assert.strictEqual(facts.incoterm, 'FOB');
    assert.strictEqual(facts.country_of_origin, 'Bangladesh');
    assert.strictEqual(facts.season, 'AW');
  });

  await test('extracts 5 ratio pack sizes with unit cost from raj_461-38901.pdf', async () => {
    const buffer = loadFixture('raj_461-38901.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractRaj(result.text);

    assert.strictEqual(facts.items.length, 5);
    const sizes = facts.items.map(i => i.size);
    assert.deepStrictEqual(sizes, ['10', '12', '8', '14', '16']);
    facts.items.forEach(item => {
      assert.strictEqual(item.cost_price, '9.62');
    });
  });

  await test('correctly parses the second Raj PO (PO number in different position)', async () => {
    const buffer = loadFixture('raj_461-38931.pdf');
    const { PDFParse } = require('pdf-parse');
    const result = await new PDFParse({ data: buffer }).getText();
    const facts = extractRaj(result.text);

    assert.strictEqual(facts.po_number, '461-38931');
    assert.strictEqual(facts.supplier_no, '1007679');
  });

  console.log('\n=== extractFromPDF() end-to-end ===');

  await test('returns success:true with correct layout for each sample PDF', async () => {
    const files = {
      'brightkids_2450187.pdf': 'BrightKids',
      'george_1208545.pdf': 'ThreadHaven',
      'george_1208546.pdf': 'ThreadHaven',
      'raj_461-38901.pdf': 'Raj International Sourcing',
      'raj_461-38931.pdf': 'Raj International Sourcing'
    };

    for (const [filename, expectedBrand] of Object.entries(files)) {
      const buffer = loadFixture(filename);
      const base64 = buffer.toString('base64');
      const result = await extractFromPDF(base64, filename);

      assert.strictEqual(result.success, true, `${filename} should extract successfully`);
      assert.strictEqual(result.extracted_facts.document_brand, expectedBrand, `${filename} brand mismatch`);
    }
  });

  await test('returns success:false for a non-PDF / unrecognised input', async () => {
    const fakeBase64 = Buffer.from('not a real pdf').toString('base64');
    const result = await extractFromPDF(fakeBase64, 'fake.pdf');
    assert.strictEqual(result.success, false);
  });

  // =====================================================================
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40));

  if (failed > 0) {
    process.exit(1);
  }
}

run();