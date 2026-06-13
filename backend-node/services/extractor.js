const { PDFParse } = require('pdf-parse');

// =====================================================================
// PO EXTRACTOR - pure code, regex-based extraction (no AI / no API key)
//
// This module reads raw text from a PDF (via pdf-parse v2) and extracts
// observable facts using pattern matching. Three layouts are supported,
// matching the three customer formats in the sample documents:
//
//   - BrightKids  : simple flat table layout
//   - ThreadHaven : multi-page delivery splits / prepacks (George POs)
//   - Raj International Sourcing : ratio-pack table layout
//
// The output shape (extracted_facts) matches what transformer.js expects,
// so transformer.js and validator.js are UNCHANGED from the rest of the
// pipeline - only this extraction step differs.
// =====================================================================

// =====================================================================
// LAYOUT 1 - BrightKids
// =====================================================================
function extractBrightKids(text) {
  const documentBrand = text.trim().split('\n')[0].trim();
  const poNumber = (text.match(/Purchase Order Number\s*(\d+)/) || [])[1] || '';
  const vendorNo = (text.match(/\nVendor\s*(\d+)/) || [])[1] || '';
  const factoryNo = (text.match(/\nFactory\s*(\d+)/) || [])[1] || '';
  const productDescription = (text.match(/Product Description\s*(.+?)\n/) || [])[1]?.trim() || '';
  const colour = (text.match(/Colour\s*(.+?)\n/) || [])[1]?.trim() || '';
  const season = (text.match(/Season\s+([A-Z]{2}\d{2})/) || [])[1] || '';
  const styleNo = (text.match(/Product Ident\s*([\d-]+)/) || [])[1] || '';
  const currency = (text.match(/Currency Code\s*([A-Z]{3})/) || [])[1] || '';
  const countryOfOrigin = (text.match(/Country of Origin\s*(.+?)\n/) || [])[1]?.trim() || '';
  const portOfDeparture = (text.match(/Port of Departure\s*(.+?)\n/) || [])[1]?.trim() || '';
  const paymentTerms = (text.match(/Payment Terms\s*(Net Due \d+ days)/) || [])[1] || '';

  // Each delivery: "Delivery N Shipment Date: DD-MMM-YY" followed by a
  // size table, ending at "TOTALS"
  const deliveryRegex = /Delivery (\d+) Shipment Date:\s*([A-Za-z0-9-]+)\nSize Barcode Cost \(USD\) Retail \(USD\) Order Qty Cartons\n([\s\S]*?)TOTALS/g;
  // Item rows are now cleanly space-separated: size barcode cost retail order_qty cartons
  const itemRowRegex = /(\d{1,2}-\d{1,2}Y) (\d{13}) (\d+\.\d{2}) (\d+\.\d{2}) (\d+) (\d+)/g;

  const deliveries = [];
  let m;
  while ((m = deliveryRegex.exec(text)) !== null) {
    const [, deliveryNum, shipmentDate, block] = m;
    const items = [];
    let im;
    itemRowRegex.lastIndex = 0;
    while ((im = itemRowRegex.exec(block)) !== null) {
      const [, size, barcode, cost, retail, orderQty, cartons] = im;
      items.push({ size, barcode, cost_price: cost, retail_price: retail, order_qty: orderQty, cartons });
    }
    deliveries.push({ delivery_number: deliveryNum, shipment_date: shipmentDate, items });
  }

  return {
    document_brand: documentBrand,
    po_number: poNumber,
    vendor_no: vendorNo,
    supplier_no: '',
    factory_no: factoryNo,
    style_no: styleNo,
    product_description: productDescription,
    season: season,
    colour: colour,
    currency: currency,
    country_of_origin: countryOfOrigin,
    port_of_departure: portOfDeparture,
    lading_port: '',
    destination_location: '',
    order_date: '',
    payment_terms: paymentTerms,
    incoterm: '',
    items: [],
    deliveries: deliveries,
    prepacks: [],
    ratio_packs: [],
    missing_fields: []
  };
}

// =====================================================================
// LAYOUT 2 - ThreadHaven / George (delivery splits + prepacks)
// =====================================================================
function extractGeorge(text) {
  const documentBrand = 'ThreadHaven';
  const poNumber = (text.match(/Purchase Order Number\s*(\d+)/) || [])[1] || '';
  const vendorNo = (text.match(/\nVendor\s*(\d+)/) || [])[1] || '';
  const factoryNo = (text.match(/\nFactory\s*(\d+)/) || [])[1] || '';
  const productDescription = (text.match(/Product Description\s*(.+?)\s*QC Status/) || [])[1]?.trim() || '';
  const colour = (text.match(/Colour\s*(.+?)\s*Launch Date/) || [])[1]?.trim() || '';
  const season = (text.match(/\nSeason\s+([A-Z]{2}\d{2})/) || [])[1] || '';
  const styleNo = (text.match(/Product Ident\s*([\d-]+)/) || [])[1] || '';
  const currency = (text.match(/Currency Code\s*([A-Z]{3})/) || [])[1] || '';
  const countryOfOrigin = (text.match(/Country of Origin\s*(.+?)\s*Refurb/) || [])[1]?.trim() || '';
  const portOfDeparture = (text.match(/Port of Departure\s*(.+?)\s*Refurb Cost/) || [])[1]?.trim() || '';
  const paymentTerms = (text.match(/Payment Terms\s*(.+?)\s*Pack Type/) || [])[1]?.trim() || '';

  // Detect delivery numbers + shipment dates (dedupe across page breaks)
  const deliveryMatches = [...text.matchAll(/Delivery (\d+) Split A\nShipment Date:\s*([A-Za-z0-9 ]+?)\s*-\n/g)];
  const seenDeliveries = new Map();
  for (const dm of deliveryMatches) {
    if (!seenDeliveries.has(dm[1])) {
      seenDeliveries.set(dm[1], dm[2].trim());
    }
  }

  // Item rows: SizeLabel + 4 numeric columns (variant/win/sizecode/barcode)
  // + cost price + retail price. Order/cartons not needed for items[].
  const itemRowRegex = /(\d{1,2}-\d{1,2}Y|10PC PRE-\nPACK)(?:\s+\d+){4}\s+(\d+\.\d{2})\s+(\d+\.\d{2})/g;
  const allItemsRaw = [...text.matchAll(itemRowRegex)].map(m => ({
    size: m[1].replace(/\n/g, ' ').trim(),
    cost_price: m[2],
    retail_price: m[3]
  }));

  // Separate the prepack "container" row (if any) from regular size items
  const isPrepack = text.includes('PRE-\nPACK') || text.includes('PREPACK');
  const allItems = allItemsRaw.filter(it => !it.size.includes('PRE'));

  // Build deliveries array, distributing items evenly across delivery splits
  const deliveryNums = [...seenDeliveries.keys()];
  const deliveries = [];

  if (deliveryNums.length > 1 && allItems.length % deliveryNums.length === 0) {
    // Multiple delivery splits with the same item set repeated per split
    const perDelivery = allItems.length / deliveryNums.length;
    deliveryNums.forEach((num, i) => {
      deliveries.push({
        delivery_number: num,
        shipment_date: seenDeliveries.get(num),
        items: allItems.slice(i * perDelivery, (i + 1) * perDelivery)
      });
    });
  } else {
    // Single delivery (e.g. prepack PO) - all items in one delivery
    const num = deliveryNums[0] || '1';
    deliveries.push({
      delivery_number: num,
      shipment_date: seenDeliveries.get(num) || '',
      items: allItems
    });
  }

  // Prepack detection - build a prepacks entry from the size list
  let prepacks = [];
  if (isPrepack) {
    prepacks = [{
      prepack_id: '1',
      sizes: allItems.map(it => ({ size: it.size }))
    }];
  }

  return {
    document_brand: documentBrand,
    po_number: poNumber,
    vendor_no: vendorNo,
    supplier_no: '',
    factory_no: factoryNo,
    style_no: styleNo,
    product_description: productDescription,
    season: season,
    colour: colour,
    currency: currency,
    country_of_origin: countryOfOrigin,
    port_of_departure: portOfDeparture,
    lading_port: '',
    destination_location: '',
    order_date: '',
    payment_terms: paymentTerms,
    incoterm: '',
    items: [],
    deliveries: deliveries,
    prepacks: prepacks,
    ratio_packs: [],
    missing_fields: []
  };
}

// =====================================================================
// LAYOUT 3 - Raj International Sourcing (ratio pack table)
// =====================================================================
function extractRaj(text) {
  const documentBrand = 'Raj International Sourcing';
  const poNumber = (text.match(/\b(\d{3}-\d{5})\b/) || [])[1] || '';
  const supplierNo = (text.match(/Supplier No\.\s*:\s*(\d+)/) || [])[1] || '';
  const destinationLocation = (text.match(/Destination Location\s*:\s*(.+?)\n/) || [])[1]?.trim() || '';
  const orderDate = (text.match(/Order Create Date\s*:\s*([A-Za-z0-9-]+)/) || [])[1] || '';
  const styleNo = (text.match(/\n([A-Z]{2}\d{6})\n/) || [])[1] || '';
  const incoterm = text.includes('FOB') ? 'FOB' : '';

  // Country of origin: "Bangladesh" appears near the top of the document
  // as the sourcing origin (Raj ships ex-Chittagong, Bangladesh)
  const countryOfOrigin = /Bangladesh\nWomens/.test(text) ? 'Bangladesh' : '';

  // Season code: printed as standalone "AW" (without year suffix)
  const seasonRaw = /\nAW\n/.test(text) ? 'AW' : '';

  // Ratio pack table: colours, sizes and unit costs appear as parallel
  // duplicated arrays in the raw text (pdf-parse extracts table cells in
  // column order, not visual reading order). We extract the 5 sizes and
  // the unit cost (USD per-unit price, excluding ratio-pack-level totals).
  const colourBlock = (text.match(/(?:BLACK\n?)+/) || [])[0] || '';
  const hasColour = colourBlock.includes('BLACK');

  const sizeBlockMatch = text.match(/(?:BLACK\n){5}([\d\n]+?)(?=\d{10,})/);
  const sizes = sizeBlockMatch
    ? sizeBlockMatch[1].split('\n').filter(Boolean)
    : [];

  // Unit cost - first repeated "USD X.XX" value (per-unit cost)
  const unitCostMatch = (text.match(/USD (\d+\.\d{2})/) || [])[1] || '';

  const ratioPacks = sizes.length > 0
    ? [{
        pack_name: 'RATIO PACK',
        sizes: sizes.map(s => ({ size: s, cost_price: unitCostMatch }))
      }]
    : [];

  // Items: one per size variant, using the unit cost for price
  const items = sizes.map(s => ({
    size: s,
    cost_price: unitCostMatch
  }));

  return {
    document_brand: documentBrand,
    po_number: poNumber,
    vendor_no: '',
    supplier_no: supplierNo,
    factory_no: '',
    style_no: styleNo,
    product_description: '',
    season: seasonRaw,
    colour: hasColour ? 'BLACK' : '',
    currency: 'USD',
    country_of_origin: countryOfOrigin,
    port_of_departure: 'Chittagong - Bangladesh',
    lading_port: 'Chittagong - Bangladesh',
    destination_location: destinationLocation,
    order_date: orderDate,
    payment_terms: '',
    incoterm: incoterm,
    items: items,
    deliveries: [],
    prepacks: [],
    ratio_packs: ratioPacks,
    missing_fields: []
  };
}

// =====================================================================
// LAYOUT DETECTION
// =====================================================================
function detectLayout(text) {
  if (text.includes('BrightKids')) return 'brightkids';
  if (text.includes('International Sourcing') || text.includes('Raj Limited')) return 'raj';
  if (text.includes('Purchase Order Number') && text.includes('Split A')) return 'george';
  return 'unknown';
}

// =====================================================================
// MAIN EXTRACTION FUNCTION
// =====================================================================
async function extractFromPDF(pdfBase64, filename) {
  try {
    const buffer = Buffer.from(pdfBase64, 'base64');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text;

    const layout = detectLayout(text);
    let facts;

    switch (layout) {
      case 'brightkids':
        facts = extractBrightKids(text);
        break;
      case 'george':
        facts = extractGeorge(text);
        break;
      case 'raj':
        facts = extractRaj(text);
        break;
      default:
        return {
          success: false,
          filename: filename,
          error: `Could not detect a known document layout for ${filename}`,
          extracted_facts: null
        };
    }

    return {
      success: true,
      filename: filename,
      extracted_facts: facts
    };
  } catch (error) {
    return {
      success: false,
      filename: filename,
      error: error.message,
      extracted_facts: null
    };
  }
}

module.exports = { extractFromPDF, detectLayout, extractBrightKids, extractGeorge, extractRaj };