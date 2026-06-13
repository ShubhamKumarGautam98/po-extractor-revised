const fs = require('fs');
const path = require('path');

// -- Load field schema --
function loadSchema() {
  const schemaPath = path.join(__dirname, '../config/field_schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
}

// -- Check a section for missing fields --
function checkSection(sectionData, requiredFields, sectionName) {
  const issues = [];

  if (!sectionData) {
    issues.push({
      section: sectionName,
      field:   sectionName,
      message: `${sectionName} section is missing entirely`
    });
    return issues;
  }

  for (const field of requiredFields) {
    const value = sectionData[field];
    if (value === undefined || value === null || value === '') {
      issues.push({
        section: sectionName,
        field:   field,
        message: `${sectionName}.${field} is missing or empty`
      });
    }
  }

  return issues;
}

// -- Check array sections (suppliers, items, shipments) --
function checkArraySection(sectionArray, requiredFields, sectionName) {
  const issues = [];

  if (!sectionArray || sectionArray.length === 0) {
    issues.push({
      section: sectionName,
      field:   sectionName,
      message: `${sectionName} section is empty - no records found`
    });
    return issues;
  }

  sectionArray.forEach((record, index) => {
    for (const field of requiredFields) {
      const value = record[field];
      if (value === undefined || value === null || value === '') {
        issues.push({
          section: sectionName,
          field:   field,
          message: `${sectionName}[${index}].${field} is missing or empty`
        });
      }
    }
  });

  return issues;
}

// -- Determine status from issues --
function determineStatus(issues, transformSuccess) {
  if (!transformSuccess) return 'failed';
  if (issues.length === 0) return 'artifact_ready';
  return 'needs_review';
}

// -- MAIN VALIDATE FUNCTION --
function validate(transformResult) {
  // If transformation itself failed, mark as failed immediately
  if (!transformResult.success || !transformResult.purchase_order) {
    return {
      status: 'failed',
      purchase_order: null,
      issues: [
        {
          section: 'pipeline',
          field:   'transformation',
          message: transformResult.error || 'Transformation step failed'
        }
      ]
    };
  }

  const schema = loadSchema();
  const po     = transformResult.purchase_order;
  const issues = [];

  // -- Check each section --
  const headerIssues    = checkSection(
    po.header,
    schema.required_header_fields,
    'header'
  );

  const prIssues        = checkSection(
    po.pr,
    schema.required_pr_fields,
    'pr'
  );

  const supplierIssues  = checkArraySection(
    po.suppliers,
    schema.required_supplier_fields,
    'suppliers'
  );

  const itemIssues      = checkArraySection(
    po.items,
    schema.required_item_fields,
    'items'
  );

  const shipmentIssues  = checkArraySection(
    po.shipments,
    schema.required_shipment_fields,
    'shipments'
  );

  // -- Combine all issues --
  issues.push(
    ...headerIssues,
    ...prIssues,
    ...supplierIssues,
    ...itemIssues,
    ...shipmentIssues
  );

  // -- Also carry over any missing_fields flagged by AI during extraction --
  if (
    transformResult.extracted_facts &&
    transformResult.extracted_facts.missing_fields &&
    transformResult.extracted_facts.missing_fields.length > 0
  ) {
    for (const field of transformResult.extracted_facts.missing_fields) {
      issues.push({
        section: 'extraction',
        field:   field,
        message: `Field "${field}" was not found in the source PDF`
      });
    }
  }

  const status = determineStatus(issues, transformResult.success);

  return {
    status,
    purchase_order: po,
    issues
  };
}

module.exports = { validate, loadSchema };
