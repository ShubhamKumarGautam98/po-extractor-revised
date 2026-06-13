"""
Field validation and status determination.

Direct port of validator.js - same logic, same checks, same output shape.
Reads field_schema.json at runtime.
"""

import json
import os

CONFIG_DIR = os.path.join(os.path.dirname(__file__), '..', 'config')


# -- Load field schema --
def load_schema():
    schema_path = os.path.join(CONFIG_DIR, 'field_schema.json')
    with open(schema_path, 'r', encoding='utf-8') as f:
        return json.load(f)


# -- Check a section for missing fields --
def check_section(section_data, required_fields, section_name):
    issues = []

    if not section_data:
        issues.append({
            'section': section_name,
            'field': section_name,
            'message': f'{section_name} section is missing entirely'
        })
        return issues

    for field in required_fields:
        value = section_data.get(field)
        if value is None or value == '':
            issues.append({
                'section': section_name,
                'field': field,
                'message': f'{section_name}.{field} is missing or empty'
            })

    return issues


# -- Check array sections (suppliers, items, shipments) --
def check_array_section(section_array, required_fields, section_name):
    issues = []

    if not section_array:
        issues.append({
            'section': section_name,
            'field': section_name,
            'message': f'{section_name} section is empty - no records found'
        })
        return issues

    for index, record in enumerate(section_array):
        for field in required_fields:
            value = record.get(field)
            if value is None or value == '':
                issues.append({
                    'section': section_name,
                    'field': field,
                    'message': f'{section_name}[{index}].{field} is missing or empty'
                })

    return issues


# -- Determine status from issues --
def determine_status(issues, transform_success):
    if not transform_success:
        return 'failed'
    if not issues:
        return 'artifact_ready'
    return 'needs_review'


# -- MAIN VALIDATE FUNCTION --
def validate(transform_result):
    if not transform_result.get('success') or not transform_result.get('purchase_order'):
        return {
            'status': 'failed',
            'purchase_order': None,
            'issues': [{
                'section': 'pipeline',
                'field': 'transformation',
                'message': transform_result.get('error', 'Transformation step failed')
            }]
        }

    schema = load_schema()
    po = transform_result['purchase_order']
    issues = []

    issues += check_section(po.get('header'), schema['required_header_fields'], 'header')
    issues += check_section(po.get('pr'), schema['required_pr_fields'], 'pr')
    issues += check_array_section(po.get('suppliers'), schema['required_supplier_fields'], 'suppliers')
    issues += check_array_section(po.get('items'), schema['required_item_fields'], 'items')
    issues += check_array_section(po.get('shipments'), schema['required_shipment_fields'], 'shipments')

    # Carry over any missing_fields flagged during extraction
    extracted_facts = transform_result.get('extracted_facts') or {}
    missing_fields = extracted_facts.get('missing_fields') or []
    for field in missing_fields:
        issues.append({
            'section': 'extraction',
            'field': field,
            'message': f'Field "{field}" was not found in the source PDF'
        })

    status = determine_status(issues, transform_result['success'])

    return {
        'status': status,
        'purchase_order': po,
        'issues': issues
    }
