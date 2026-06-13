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

// -- Apply ITEM defaults --
function applyItemDefaults(rules) {
  const result = {};
  const defaultRules = rules.filter(r => r.rule_type === 'item_default');
  for (const rule of defaultRules) {
    result[rule.target_field.replace('items.', '')] = rule.target_value;
  }
  return result;
}

// -- Apply single-key lookup --
// -- Build a label -> value map of extracted facts.
// This lets composite-key rules (source_value containing "|") match on
// multiple printed fields at once, e.g. a CSV row with
// source_label = "Style No|Season" and source_value = "AD627488|AW26"
// can be matched against facts.style_no and facts.season together.
function buildFactsByLabel(facts, customerCode) {
  return {
    'document brand':       facts.document_brand || '',
    'customer':             customerCode || '',
    'vendor no':            facts.vendor_no || '',
    'supplier no':          facts.supplier_no || '',
    'factory no':           facts.factory_no || '',
    'style no':             facts.style_no || extractStyleNo(facts) || '',
    'season':               facts.season || '',
    'currency':             facts.currency || '',
    'country of origin':    facts.country_of_origin || '',
    'port of departure':    facts.port_of_departure || '',
    'lading port':          facts.lading_port || '',
    'destination location': facts.destination_location || '',
    'incoterm code':        (facts.incoterm || 'FOB').trim()
  };
}

// -- Apply single-key OR composite-key lookup --
//
// Single-key (existing behaviour, unchanged): rule.source_value is matched
// directly against sourceValue.
//
// Composite-key (new, additive): when rule.source_value contains "|",
// it's split alongside rule.source_label on "|", and EVERY part must match
// the corresponding fact in factsByLabel for the rule to apply, e.g.
//   source_label = "Style No|Season", source_value = "AD627488|AW26"
// matches only when factsByLabel['style no'] === 'ad627488' AND
// factsByLabel['season'] === 'aw26'.
//
// This is purely additive: no row in the current transformation_data.csv
// contains "|", so existing behaviour for all 50 rules is unchanged.
function applyLookup(ruleType, sourceValue, rules, factsByLabel = {}) {
  const result = {};
  const normalizedSourceValue = (sourceValue || '').toLowerCase();

  // Normalize factsByLabel keys/values for case-insensitive comparison
  const normalizedFacts = {};
  for (const [label, value] of Object.entries(factsByLabel)) {
    normalizedFacts[label.toLowerCase()] = (value || '').toLowerCase();
  }

  for (const rule of rules) {
    if (rule.rule_type !== ruleType) continue;

    let matches;

    if (rule.source_value.includes('|')) {
      // Composite-key rule
      const valueParts = rule.source_value.split('|').map(v => v.trim().toLowerCase());
      const labelParts = (rule.source_label || '').split('|').map(l => l.trim().toLowerCase());

      matches = valueParts.length > 1 &&
        valueParts.length === labelParts.length &&
        valueParts.every((val, i) => normalizedFacts[labelParts[i]] === val);
    } else {
      // Single-key rule (existing behaviour)
      matches = rule.source_value.toLowerCase() === normalizedSourceValue;
    }

    if (matches) {
      // strip section prefix (suppliers. / items. / shipments. / pr.)
      const fieldName = rule.target_field.split('.').pop();
      result[fieldName] = rule.target_value;
    }
  }

  return result;
}

// -- Build HEADER section --
function buildHeader(facts, rules, customerCode, factsByLabel) {
  const defaults = applyHeaderDefaults(rules);
  const divLookup = applyLookup('division_lookup', customerCode, rules, factsByLabel);

  return {
    action:        defaults.action || 'NEW',
    customer_code: customerCode || '',
    po_num:        facts.po_number || '',
    div_code:      divLookup.div_code || ''
  };
}

// -- Build PR section --
function buildPR(facts, rules, factsByLabel) {
  const defaults = applyPRDefaults(rules);

  // Season lookup - handles "AW" -> "AW26" edge case
  const seasonRaw = facts.season || '';
  const seasonLookup = applyLookup('season_lookup', seasonRaw, rules, factsByLabel);

  // Incoterm lookup
  const incotermRaw = (facts.incoterm || '').trim();
  const incotermLookup = applyLookup('incoterm_lookup', 'FOB', rules, factsByLabel);

  return {
    issue_date:     facts.order_date || '',
    currency:       facts.currency || defaults.currency || 'USD',
    incoterm_code:  incotermLookup.incoterm_code || incotermRaw || '',
    incoterm_text:  incotermLookup.incoterm_text || '',
    season:         seasonLookup.season || seasonRaw || ''
  };
}

// -- Build SUPPLIERS section --
function buildSuppliers(facts, rules, factsByLabel) {
  // Try vendor_no first, then supplier_no
  const vendorNo = facts.vendor_no || '';
  const supplierNo = facts.supplier_no || '';

  let vendorData = {};

  if (vendorNo) {
    vendorData = applyLookup('vendor_lookup', vendorNo, rules, factsByLabel);
  }
  if (supplierNo && Object.keys(vendorData).length === 0) {
    vendorData = applyLookup('vendor_lookup', supplierNo, rules, factsByLabel);
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
function buildItems(facts, rules, poNumber, factsByLabel) {
  const countryLookup = applyLookup('country_lookup', facts.country_of_origin, rules, factsByLabel);
  const factoryLookup = applyLookup('factory_lookup', facts.factory_no, rules, factsByLabel);

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

  // -- Apply item_default rules as fallback for any field still empty --
  // (mirrors header_default / pr_default - generic, data-driven, currently
  // a no-op since transformation_data.csv has no item_default rows, but
  // a CSV row of this type would now take effect without a code change)
  const itemDefaults = applyItemDefaults(rules);
  for (const item of allItems) {
    for (const [field, value] of Object.entries(itemDefaults)) {
      if (!item[field]) {
        item[field] = value;
      }
    }
  }

  return allItems;
}

// -- Build SHIPMENTS section --
function buildShipments(facts, rules, factsByLabel) {
  // Try both port field names (different POs use different labels)
  const portRaw = facts.port_of_departure || facts.lading_port || '';
  const destRaw = facts.destination_location || '';

  const portLookup = applyLookup('port_lookup', portRaw, rules, factsByLabel);
  const destLookup = applyLookup('destination_lookup', destRaw, rules, factsByLabel);

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

  // Step 2: build a label -> value context for composite-key lookups
  const factsByLabel = buildFactsByLabel(facts, customerCode);

  // Step 3: build each section
  const header    = buildHeader(facts, rules, customerCode, factsByLabel);
  const pr        = buildPR(facts, rules, factsByLabel);
  const suppliers = buildSuppliers(facts, rules, factsByLabel);
  const items     = buildItems(facts, rules, header.po_num, factsByLabel);
  const shipments = buildShipments(facts, rules, factsByLabel);
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
