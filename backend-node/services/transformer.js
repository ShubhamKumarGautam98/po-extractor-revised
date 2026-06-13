const fs = require('fs');
const path = require('path');

// -- CSV parser (no external dependency needed) --
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

// -- Load transformation rules from CSV --
function loadRules() {
  const csvPath = path.join(__dirname, '../config/transformation_data.csv');
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  return parseCSV(csvText);
}

// -- Apply source detection --
function detectCustomer(facts, rules) {
  const detectionRules = rules.filter(r => r.rule_type === 'source_detection');
  const brand = (facts.document_brand || '').toLowerCase();

  for (const rule of detectionRules) {
    if (brand.includes(rule.source_value.toLowerCase())) {
      return rule.target_value;
    }
  }
  return null;
}

// -- Apply header defaults --
function applyHeaderDefaults(rules) {
  const result = {};
  const defaultRules = rules.filter(r => r.rule_type === 'header_default');
  for (const rule of defaultRules) {
    result[rule.target_field.replace('header.', '')] = rule.target_value;
  }
  return result;
}

// -- Apply PR defaults --
function applyPRDefaults(rules) {
  const result = {};
  const defaultRules = rules.filter(r => r.rule_type === 'pr_default');
  for (const rule of defaultRules) {
    result[rule.target_field.replace('pr.', '')] = rule.target_value;
  }
  return result;
}

// -- Apply single-key lookup --
function applyLookup(ruleType, sourceValue, rules) {
  const result = {};
  const matchingRules = rules.filter(
    r => r.rule_type === ruleType &&
    r.source_value.toLowerCase() === (sourceValue || '').toLowerCase()
  );
  for (const rule of matchingRules) {
    // strip section prefix (suppliers. / items. / shipments. / pr.)
    const fieldName = rule.target_field.split('.').pop();
    result[fieldName] = rule.target_value;
  }
  return result;
}

// -- Build HEADER section --
function buildHeader(facts, rules, customerCode) {
  const defaults = applyHeaderDefaults(rules);
  const divLookup = applyLookup('division_lookup', customerCode, rules);

  return {
    action:        defaults.action || 'NEW',
    customer_code: customerCode || '',
    po_num:        facts.po_number || '',
    div_code:      divLookup.div_code || ''
  };
}

// -- Build PR section --
function buildPR(facts, rules) {
  const defaults = applyPRDefaults(rules);

  // Season lookup - handles "AW" -> "AW26" edge case
  const seasonRaw = facts.season || '';
  const seasonLookup = applyLookup('season_lookup', seasonRaw, rules);

  // Incoterm lookup
  const incotermRaw = (facts.incoterm || '').trim();
  const incotermLookup = applyLookup('incoterm_lookup', 'FOB', rules);

  return {
    issue_date:     facts.order_date || '',
    currency:       facts.currency || defaults.currency || 'USD',
    incoterm_code:  incotermLookup.incoterm_code || incotermRaw || '',
    incoterm_text:  incotermLookup.incoterm_text || '',
    season:         seasonLookup.season || seasonRaw || ''
  };
}

// -- Build SUPPLIERS section --
function buildSuppliers(facts, rules) {
  // Try vendor_no first, then supplier_no
  const vendorNo = facts.vendor_no || '';
  const supplierNo = facts.supplier_no || '';

  let vendorData = {};

  if (vendorNo) {
    vendorData = applyLookup('vendor_lookup', vendorNo, rules);
  }
  if (supplierNo && Object.keys(vendorData).length === 0) {
    vendorData = applyLookup('vendor_lookup', supplierNo, rules);
  }

  return [
    {
      supplier_id:      '1',
      vendor_code:      vendorData.vendor_code || '',
      vendor_name:      vendorData.vendor_name || '',
      vendor_currency:  vendorData.vendor_currency || '',
      vendor_inc_code:  vendorData.vendor_inc_code || '',
      vendor_incoterm:  vendorData.vendor_incoterm || ''
    }
  ];
}

// -- Build ITEMS section --
function buildItems(facts, rules, poNumber) {
  const countryLookup = applyLookup('country_lookup', facts.country_of_origin, rules);
  const factoryLookup = applyLookup('factory_lookup', facts.factory_no, rules);

  const colour = (facts.colour || '').toUpperCase();
  const countryCode = countryLookup.country_of_origin || facts.country_of_origin || '';
  const factoryId = factoryLookup.factory_id || facts.factory_no || '';

  // Gather all size lines across deliveries
  const allItems = [];
  let itemId = 1;

  // If deliveries exist, use them
  if (facts.deliveries && facts.deliveries.length > 0) {
    for (const delivery of facts.deliveries) {
      for (const item of (delivery.items || [])) {
        allItems.push({
          item_id:            String(itemId++),
          supplier_id:        '1',
          style_no:           facts.style_no || extractStyleNo(facts),
          shipment_id:        poNumber,
          country_of_origin:  countryCode,
          price:              item.cost_price || '',
          factory_id:         factoryId,
          color:              colour,
          size_id:            item.size || ''
        });
      }
    }
  } else if (facts.items && facts.items.length > 0) {
    // Flat items (no deliveries)
    for (const item of facts.items) {
      allItems.push({
        item_id:            String(itemId++),
        supplier_id:        '1',
        style_no:           facts.style_no || extractStyleNo(facts),
        shipment_id:        poNumber,
        country_of_origin:  countryCode,
        price:              item.cost_price || '',
        factory_id:         factoryId,
        color:              colour,
        size_id:            item.size || ''
      });
    }
  }

  return allItems;
}

// -- Build SHIPMENTS section --
function buildShipments(facts, rules) {
  // Try both port field names (different POs use different labels)
  const portRaw = facts.port_of_departure || facts.lading_port || '';
  const destRaw = facts.destination_location || '';

  const portLookup = applyLookup('port_lookup', portRaw, rules);
  const destLookup = applyLookup('destination_lookup', destRaw, rules);

  const shipments = [];

  if (facts.deliveries && facts.deliveries.length > 0) {
    facts.deliveries.forEach((delivery, index) => {
      shipments.push({
        shipment_id:        String(index + 1),
        port_of_loading:    portLookup.port_of_loading || portRaw || '',
        port_of_discharge:  destLookup.port_of_discharge || '',
        final_destination:  destLookup.final_destination || ''
      });
    });
  } else {
    shipments.push({
      shipment_id:        '1',
      port_of_loading:    portLookup.port_of_loading || portRaw || '',
      port_of_discharge:  destLookup.port_of_discharge || '',
      final_destination:  destLookup.final_destination || ''
    });
  }

  return shipments;
}

// -- Build PREPACKS section --
function buildPrepacks(facts) {
  if (!facts.prepacks || facts.prepacks.length === 0) {
    // Check ratio packs (Raj POs use ratio_packs)
    if (!facts.ratio_packs || facts.ratio_packs.length === 0) {
      return [];
    }

    return facts.ratio_packs.map((pack, index) => ({
      prepack_id: String(index + 1),
      details: (pack.sizes || []).map((s, i) => ({
        id:         String(i + 1),
        size_id:    s.size || '',
        pack_color: pack.pack_name || ''
      }))
    }));
  }

  return facts.prepacks.map((pack, index) => ({
    prepack_id: String(index + 1),
    details: (pack.sizes || []).map((s, i) => ({
      id:         String(i + 1),
      size_id:    s.size || '',
      pack_color: pack.prepack_id || String(index + 1)
    }))
  }));
}

// -- Helper: extract style number from product description --
function extractStyleNo(facts) {
  // Some POs embed style no in description (e.g. "JL627409")
  const desc = facts.product_description || '';
  const match = desc.match(/\b[A-Z]{2}\d{6}\b/);
  return match ? match[0] : '';
}

// -- MAIN TRANSFORM FUNCTION --
function transform(extractionResult) {
  if (!extractionResult.success || !extractionResult.extracted_facts) {
    return {
      success: false,
      filename: extractionResult.filename,
      error: extractionResult.error || 'Extraction failed',
      purchase_order: null
    };
  }

  const facts = extractionResult.extracted_facts;
  const rules = loadRules();

  // Step 1: detect customer
  const customerCode = detectCustomer(facts, rules);

  // Step 2: build each section
  const header    = buildHeader(facts, rules, customerCode);
  const pr        = buildPR(facts, rules);
  const suppliers = buildSuppliers(facts, rules);
  const items     = buildItems(facts, rules, header.po_num);
  const shipments = buildShipments(facts, rules);
  const prepacks  = buildPrepacks(facts);

  return {
    success:  true,
    filename: extractionResult.filename,
    extracted_facts: facts,
    purchase_order: {
      source_file: extractionResult.filename,
      header,
      pr,
      suppliers,
      items,
      shipments,
      prepacks
    }
  };
}

module.exports = { transform, loadRules, applyLookup, detectCustomer };
