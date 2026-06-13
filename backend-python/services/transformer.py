"""
CSV-driven transformation engine.

This is a direct port of transformer.js - same logic, same rule types,
same output shape. Reads transformation_data.csv at runtime on every call.
"""

import csv
import os
import re

CONFIG_DIR = os.path.join(os.path.dirname(__file__), '..', 'config')


# -- Load transformation rules from CSV --
def load_rules():
    csv_path = os.path.join(CONFIG_DIR, 'transformation_data.csv')
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]


# -- Apply source detection --
def detect_customer(facts, rules):
    detection_rules = [r for r in rules if r['rule_type'] == 'source_detection']
    brand = (facts.get('document_brand') or '').lower()

    for rule in detection_rules:
        if rule['source_value'].lower() in brand:
            return rule['target_value']
    return None


# -- Apply header defaults --
def apply_header_defaults(rules):
    result = {}
    for rule in rules:
        if rule['rule_type'] == 'header_default':
            result[rule['target_field'].replace('header.', '')] = rule['target_value']
    return result


# -- Apply PR defaults --
def apply_pr_defaults(rules):
    result = {}
    for rule in rules:
        if rule['rule_type'] == 'pr_default':
            result[rule['target_field'].replace('pr.', '')] = rule['target_value']
    return result


# -- Apply single-key lookup --
def apply_lookup(rule_type, source_value, rules):
    result = {}
    source_value = (source_value or '').lower()
    for rule in rules:
        if rule['rule_type'] == rule_type and rule['source_value'].lower() == source_value:
            # strip section prefix (suppliers. / items. / shipments. / pr.)
            field_name = rule['target_field'].split('.')[-1]
            result[field_name] = rule['target_value']
    return result


# -- Build HEADER section --
def build_header(facts, rules, customer_code):
    defaults = apply_header_defaults(rules)
    div_lookup = apply_lookup('division_lookup', customer_code, rules)

    return {
        'action': defaults.get('action', 'NEW'),
        'customer_code': customer_code or '',
        'po_num': facts.get('po_number') or '',
        'div_code': div_lookup.get('div_code', '')
    }


# -- Build PR section --
def build_pr(facts, rules):
    defaults = apply_pr_defaults(rules)

    # Season lookup - handles "AW" -> "AW26" edge case
    season_raw = facts.get('season') or ''
    season_lookup = apply_lookup('season_lookup', season_raw, rules)

    # Incoterm lookup
    incoterm_raw = (facts.get('incoterm') or '').strip()
    incoterm_lookup = apply_lookup('incoterm_lookup', 'FOB', rules)

    return {
        'issue_date': facts.get('order_date') or '',
        'currency': facts.get('currency') or defaults.get('currency', 'USD'),
        'incoterm_code': incoterm_lookup.get('incoterm_code') or incoterm_raw or '',
        'incoterm_text': incoterm_lookup.get('incoterm_text', ''),
        'season': season_lookup.get('season') or season_raw or ''
    }


# -- Build SUPPLIERS section --
def build_suppliers(facts, rules):
    vendor_no = facts.get('vendor_no') or ''
    supplier_no = facts.get('supplier_no') or ''

    vendor_data = {}
    if vendor_no:
        vendor_data = apply_lookup('vendor_lookup', vendor_no, rules)
    if supplier_no and not vendor_data:
        vendor_data = apply_lookup('vendor_lookup', supplier_no, rules)

    return [{
        'supplier_id': '1',
        'vendor_code': vendor_data.get('vendor_code', ''),
        'vendor_name': vendor_data.get('vendor_name', ''),
        'vendor_currency': vendor_data.get('vendor_currency', ''),
        'vendor_inc_code': vendor_data.get('vendor_inc_code', ''),
        'vendor_incoterm': vendor_data.get('vendor_incoterm', '')
    }]


# -- Helper: extract style number from product description --
def extract_style_no(facts):
    desc = facts.get('product_description') or ''
    match = re.search(r'\b[A-Z]{2}\d{6}\b', desc)
    return match.group(0) if match else ''


# -- Build ITEMS section --
def build_items(facts, rules, po_number):
    country_lookup = apply_lookup('country_lookup', facts.get('country_of_origin'), rules)
    factory_lookup = apply_lookup('factory_lookup', facts.get('factory_no'), rules)

    colour = (facts.get('colour') or '').upper()
    country_code = country_lookup.get('country_of_origin') or facts.get('country_of_origin') or ''
    factory_id = factory_lookup.get('factory_id') or facts.get('factory_no') or ''

    all_items = []
    item_id = 1

    deliveries = facts.get('deliveries') or []
    if deliveries:
        for delivery in deliveries:
            for item in (delivery.get('items') or []):
                all_items.append({
                    'item_id': str(item_id),
                    'supplier_id': '1',
                    'style_no': facts.get('style_no') or extract_style_no(facts),
                    'shipment_id': po_number,
                    'country_of_origin': country_code,
                    'price': item.get('cost_price', ''),
                    'factory_id': factory_id,
                    'color': colour,
                    'size_id': item.get('size', '')
                })
                item_id += 1
    elif facts.get('items'):
        for item in facts['items']:
            all_items.append({
                'item_id': str(item_id),
                'supplier_id': '1',
                'style_no': facts.get('style_no') or extract_style_no(facts),
                'shipment_id': po_number,
                'country_of_origin': country_code,
                'price': item.get('cost_price', ''),
                'factory_id': factory_id,
                'color': colour,
                'size_id': item.get('size', '')
            })
            item_id += 1

    return all_items


# -- Build SHIPMENTS section --
def build_shipments(facts, rules):
    port_raw = facts.get('port_of_departure') or facts.get('lading_port') or ''
    dest_raw = facts.get('destination_location') or ''

    port_lookup = apply_lookup('port_lookup', port_raw, rules)
    dest_lookup = apply_lookup('destination_lookup', dest_raw, rules)

    shipments = []
    deliveries = facts.get('deliveries') or []

    if deliveries:
        for index, _ in enumerate(deliveries):
            shipments.append({
                'shipment_id': str(index + 1),
                'port_of_loading': port_lookup.get('port_of_loading') or port_raw or '',
                'port_of_discharge': dest_lookup.get('port_of_discharge', ''),
                'final_destination': dest_lookup.get('final_destination', '')
            })
    else:
        shipments.append({
            'shipment_id': '1',
            'port_of_loading': port_lookup.get('port_of_loading') or port_raw or '',
            'port_of_discharge': dest_lookup.get('port_of_discharge', ''),
            'final_destination': dest_lookup.get('final_destination', '')
        })

    return shipments


# -- Build PREPACKS section --
def build_prepacks(facts):
    prepacks = facts.get('prepacks') or []
    ratio_packs = facts.get('ratio_packs') or []

    if not prepacks:
        if not ratio_packs:
            return []

        return [{
            'prepack_id': str(index + 1),
            'details': [
                {
                    'id': str(i + 1),
                    'size_id': s.get('size', ''),
                    'pack_color': pack.get('pack_name', '')
                }
                for i, s in enumerate(pack.get('sizes') or [])
            ]
        } for index, pack in enumerate(ratio_packs)]

    return [{
        'prepack_id': str(index + 1),
        'details': [
            {
                'id': str(i + 1),
                'size_id': s.get('size', ''),
                'pack_color': pack.get('prepack_id') or str(index + 1)
            }
            for i, s in enumerate(pack.get('sizes') or [])
        ]
    } for index, pack in enumerate(prepacks)]


# -- MAIN TRANSFORM FUNCTION --
def transform(extraction_result):
    if not extraction_result.get('success') or not extraction_result.get('extracted_facts'):
        return {
            'success': False,
            'filename': extraction_result.get('filename'),
            'error': extraction_result.get('error', 'Extraction failed'),
            'purchase_order': None
        }

    facts = extraction_result['extracted_facts']
    rules = load_rules()

    customer_code = detect_customer(facts, rules)

    header = build_header(facts, rules, customer_code)
    pr = build_pr(facts, rules)
    suppliers = build_suppliers(facts, rules)
    items = build_items(facts, rules, header['po_num'])
    shipments = build_shipments(facts, rules)
    prepacks = build_prepacks(facts)

    return {
        'success': True,
        'filename': extraction_result['filename'],
        'extracted_facts': facts,
        'purchase_order': {
            'source_file': extraction_result['filename'],
            'header': header,
            'pr': pr,
            'suppliers': suppliers,
            'items': items,
            'shipments': shipments,
            'prepacks': prepacks
        }
    }
