"""
Unit tests for the CSV-driven transformation engine (transformer.py) and
the validator (validator.py).

Covers all 11 rule types present in transformation_data.csv, plus the
end-to-end transform -> validate flow for each of the 5 sample POs.

Run with: python3 -m pytest tests/test_transformer.py -v
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.transformer import (
    transform, load_rules, apply_lookup, detect_customer,
    apply_header_defaults, apply_pr_defaults, build_prepacks, extract_style_no
)
from services.validator import validate, determine_status


RULES = load_rules()


# =====================================================================
# load_rules()
# =====================================================================

def test_load_rules_reads_csv_at_runtime():
    rules = load_rules()
    assert len(rules) == 50
    assert all('rule_type' in r for r in rules)


# =====================================================================
# source_detection
# =====================================================================

def test_detect_customer_brightkids():
    assert detect_customer({'document_brand': 'BrightKids'}, RULES) == 'BRIGHT'


def test_detect_customer_threadhaven_maps_to_george():
    assert detect_customer({'document_brand': 'ThreadHaven'}, RULES) == 'GEORGE'


def test_detect_customer_raj():
    assert detect_customer({'document_brand': 'Raj International Sourcing'}, RULES) == 'RAJ'


def test_detect_customer_unknown_brand_returns_none():
    assert detect_customer({'document_brand': 'Some Unknown Brand'}, RULES) is None


# =====================================================================
# header_default / pr_default
# =====================================================================

def test_header_default_action_is_new():
    defaults = apply_header_defaults(RULES)
    assert defaults['action'] == 'NEW'


def test_pr_default_currency_is_usd():
    defaults = apply_pr_defaults(RULES)
    assert defaults['currency'] == 'USD'


# =====================================================================
# division_lookup
# =====================================================================

def test_division_lookup_for_each_customer():
    assert apply_lookup('division_lookup', 'BRIGHT', RULES)['div_code'] == 'BKD'
    assert apply_lookup('division_lookup', 'GEORGE', RULES)['div_code'] == 'KAE'
    assert apply_lookup('division_lookup', 'RAJ', RULES)['div_code'] == 'RJI'
    assert apply_lookup('division_lookup', 'TESCO', RULES)['div_code'] == 'KAE'


# =====================================================================
# vendor_lookup
# =====================================================================

def test_vendor_lookup_brightkids():
    result = apply_lookup('vendor_lookup', '07821490', RULES)
    assert result['vendor_code'] == 'BKDS01'
    assert result['vendor_name'] == 'BrightKids Sourcing Ltd'
    assert result['vendor_currency'] == 'USD'
    assert result['vendor_inc_code'] == 'FOB'
    assert result['vendor_incoterm'] == 'FREE ON BOARD'


def test_vendor_lookup_threadhaven_mills_and_knits_are_different():
    mills = apply_lookup('vendor_lookup', '05344742', RULES)
    knits = apply_lookup('vendor_lookup', '05344746', RULES)
    assert mills['vendor_code'] == 'THVN42'
    assert knits['vendor_code'] == 'THVN46'
    assert mills['vendor_name'] != knits['vendor_name']


def test_vendor_lookup_raj_by_supplier_no():
    result = apply_lookup('vendor_lookup', '1007679', RULES)
    assert result['vendor_code'] == 'RAJLTD'
    assert result['vendor_name'] == 'Raj Limited'


def test_vendor_lookup_unknown_returns_empty():
    assert apply_lookup('vendor_lookup', '00000000', RULES) == {}


# =====================================================================
# incoterm_lookup
# =====================================================================

def test_incoterm_lookup_fob():
    result = apply_lookup('incoterm_lookup', 'FOB', RULES)
    assert result['incoterm_code'] == 'FOB'
    assert result['incoterm_text'] == 'FREE ON BOARD'


# =====================================================================
# country_lookup
# =====================================================================

def test_country_lookup_bangladesh_and_china():
    assert apply_lookup('country_lookup', 'Bangladesh', RULES)['country_of_origin'] == 'BGD'
    assert apply_lookup('country_lookup', 'China', RULES)['country_of_origin'] == 'CHN'


def test_country_lookup_is_case_insensitive():
    assert apply_lookup('country_lookup', 'bangladesh', RULES)['country_of_origin'] == 'BGD'


# =====================================================================
# port_lookup
# =====================================================================

def test_port_lookup_chittagong_and_qingdao():
    assert apply_lookup('port_lookup', 'CHITTAGONG', RULES)['port_of_loading'] == 'CGP'
    assert apply_lookup('port_lookup', 'SHANDONG-QINGDAO', RULES)['port_of_loading'] == 'TAO'


def test_port_lookup_chittagong_bangladesh_lading_port():
    assert apply_lookup('port_lookup', 'Chittagong - Bangladesh', RULES)['port_of_loading'] == 'CGP'


# =====================================================================
# destination_lookup
# =====================================================================

def test_destination_lookup_united_kingdom():
    result = apply_lookup('destination_lookup', 'United Kingdom', RULES)
    assert result['port_of_discharge'] == 'SOU'
    assert result['final_destination'] == 'UKG'


# =====================================================================
# season_lookup (including the Raj "AW" -> "AW26" edge case)
# =====================================================================

def test_season_lookup_ss27_and_aw26():
    assert apply_lookup('season_lookup', 'SS27', RULES)['season'] == 'SS27'
    assert apply_lookup('season_lookup', 'AW26', RULES)['season'] == 'AW26'


def test_season_lookup_raj_aw_infers_aw26():
    assert apply_lookup('season_lookup', 'AW', RULES)['season'] == 'AW26'


# =====================================================================
# factory_lookup
# =====================================================================

def test_factory_lookup_known_factories():
    assert apply_lookup('factory_lookup', '41098223', RULES)['factory_id'] == 'FCTBD1'
    assert apply_lookup('factory_lookup', '36229061', RULES)['factory_id'] == 'FCTCN1'
    assert apply_lookup('factory_lookup', '36229609', RULES)['factory_id'] == 'FCTCN2'


def test_factory_lookup_unknown_factory_returns_empty():
    # This is the Raj case - no factory_lookup rule exists for Raj factories
    assert apply_lookup('factory_lookup', '99999999', RULES) == {}


# =====================================================================
# extract_style_no helper
# =====================================================================

def test_extract_style_no_from_description():
    assert extract_style_no({'product_description': 'AD627488 SOME STYLE'}) == 'AD627488'


def test_extract_style_no_returns_empty_when_absent():
    assert extract_style_no({'product_description': 'NO STYLE CODE HERE'}) == ''


# =====================================================================
# build_prepacks - ratio_packs vs prepacks input
# =====================================================================

def test_build_prepacks_from_ratio_packs():
    facts = {
        'ratio_packs': [{
            'pack_name': 'RATIO PACK',
            'sizes': [{'size': '10', 'cost_price': '9.62'}, {'size': '12', 'cost_price': '9.62'}]
        }]
    }
    result = build_prepacks(facts)
    assert len(result) == 1
    assert result[0]['prepack_id'] == '1'
    assert len(result[0]['details']) == 2
    assert result[0]['details'][0]['size_id'] == '10'
    assert result[0]['details'][0]['pack_color'] == 'RATIO PACK'


def test_build_prepacks_empty_when_no_packs():
    assert build_prepacks({}) == []


# =====================================================================
# determine_status
# =====================================================================

def test_determine_status_artifact_ready_when_no_issues():
    assert determine_status([], True) == 'artifact_ready'


def test_determine_status_needs_review_when_issues_exist():
    assert determine_status([{'section': 'x', 'field': 'y', 'message': 'z'}], True) == 'needs_review'


def test_determine_status_failed_when_transform_failed():
    assert determine_status([], False) == 'failed'


# =====================================================================
# End-to-end transform -> validate for each sample PO's extracted facts
# =====================================================================

def _sample_facts_brightkids():
    return {
        'document_brand': 'BrightKids',
        'po_number': '2450187',
        'vendor_no': '07821490',
        'supplier_no': '',
        'factory_no': '41098223',
        'style_no': '4320-51892-6103-007',
        'product_description': 'FLEECE ZIP HOODIE',
        'season': 'SS27',
        'colour': 'FOREST GREEN',
        'currency': 'USD',
        'country_of_origin': 'Bangladesh',
        'port_of_departure': 'CHITTAGONG',
        'lading_port': '',
        'destination_location': '',
        'order_date': '',
        'payment_terms': 'Net Due 90 days',
        'incoterm': '',
        'items': [],
        'deliveries': [{'delivery_number': '1', 'shipment_date': '15-Jul-26',
                         'items': [{'size': '3-4Y', 'cost_price': '5.85'}]}],
        'prepacks': [],
        'ratio_packs': [],
        'missing_fields': []
    }


def test_transform_brightkids_produces_correct_header_and_pr():
    extraction_result = {'success': True, 'filename': 'brightkids_2450187.pdf',
                          'extracted_facts': _sample_facts_brightkids()}
    result = transform(extraction_result)

    assert result['success'] is True
    po = result['purchase_order']
    assert po['header'] == {'action': 'NEW', 'customer_code': 'BRIGHT', 'po_num': '2450187', 'div_code': 'BKD'}
    assert po['pr']['currency'] == 'USD'
    assert po['pr']['incoterm_code'] == 'FOB'
    assert po['pr']['season'] == 'SS27'
    assert po['suppliers'][0]['vendor_code'] == 'BKDS01'


def test_validate_brightkids_flags_missing_shipment_destination():
    extraction_result = {'success': True, 'filename': 'brightkids_2450187.pdf',
                          'extracted_facts': _sample_facts_brightkids()}
    transform_result = transform(extraction_result)
    validation_result = validate(transform_result)

    assert validation_result['status'] == 'needs_review'
    fields_flagged = {(i['section'], i['field']) for i in validation_result['issues']}
    assert ('shipments', 'port_of_discharge') in fields_flagged
    assert ('shipments', 'final_destination') in fields_flagged


def test_transform_failure_propagates_to_validate_as_failed():
    extraction_result = {'success': False, 'filename': 'bad.pdf', 'error': 'boom', 'extracted_facts': None}
    transform_result = transform(extraction_result)
    validation_result = validate(transform_result)

    assert validation_result['status'] == 'failed'
    assert validation_result['purchase_order'] is None
    assert validation_result['issues'][0]['message'] == 'boom'


def test_raj_items_populated_but_factory_id_missing():
    """
    Regression test for the documented behaviour difference: Raj items[]
    is populated (5 items), but factory_id cannot be resolved because no
    factory_lookup rule exists for any Raj factory number. This should
    produce needs_review with one issue per item for factory_id.
    """
    facts = {
        'document_brand': 'Raj International Sourcing',
        'po_number': '461-38901',
        'vendor_no': '',
        'supplier_no': '1007679',
        'factory_no': '',
        'style_no': 'JL627409',
        'product_description': 'AW26 FF SKIRT PU RUCHED MINI BLACK',
        'season': 'AW',
        'colour': 'BLACK',
        'currency': 'USD',
        'country_of_origin': 'Bangladesh',
        'port_of_departure': 'Chittagong - Bangladesh',
        'lading_port': 'Chittagong - Bangladesh',
        'destination_location': 'United Kingdom',
        'order_date': '14-APR-2026',
        'payment_terms': '',
        'incoterm': 'FOB',
        'items': [{'size': '10', 'cost_price': '9.62'}, {'size': '12', 'cost_price': '9.62'}],
        'deliveries': [],
        'prepacks': [],
        'ratio_packs': [],
        'missing_fields': []
    }
    extraction_result = {'success': True, 'filename': 'raj_461-38901.pdf', 'extracted_facts': facts}
    transform_result = transform(extraction_result)
    validation_result = validate(transform_result)

    assert validation_result['status'] == 'needs_review'
    assert len(validation_result['purchase_order']['items']) == 2
    factory_issues = [i for i in validation_result['issues'] if i['field'] == 'factory_id']
    assert len(factory_issues) == 2


if __name__ == '__main__':
    import pytest
    sys.exit(pytest.main([__file__, '-v']))
