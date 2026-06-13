"""
Unit tests for the pdfplumber-based PO extractor.

Run with: python3 -m pytest tests/test_extractor.py -v
or:       python3 tests/test_extractor.py
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.extractor import (
    extract_from_pdf, detect_layout, extract_brightkids, extract_george, extract_raj
)
import pdfplumber

FIXTURES = os.path.join(os.path.dirname(__file__), 'fixtures')


def load_pdf(filename):
    return pdfplumber.open(os.path.join(FIXTURES, filename))


def load_bytes(filename):
    with open(os.path.join(FIXTURES, filename), 'rb') as f:
        return f.read()


# =====================================================================
# detect_layout()
# =====================================================================

def test_detects_brightkids():
    text = 'BrightKids\nPurchase Order 2450187\n...'
    assert detect_layout(text) == 'brightkids'


def test_detects_raj():
    text = 'Page 1 of 3\nInternational Sourcing\nOrder Create Date...'
    assert detect_layout(text) == 'raj'


def test_detects_george():
    text = 'Purchase Order 1208545\nDelivery 1 Split A\nShipment Date...Purchase Order Number 1208545...'
    assert detect_layout(text) == 'george'


def test_unknown_layout():
    text = 'Some random document with no matching markers'
    assert detect_layout(text) == 'unknown'


# =====================================================================
# extract_brightkids()
# =====================================================================

def test_brightkids_header_fields():
    with load_pdf('brightkids_2450187.pdf') as pdf:
        facts = extract_brightkids(pdf.pages[0])

    assert facts['document_brand'] == 'BrightKids'
    assert facts['po_number'] == '2450187'
    assert facts['vendor_no'] == '07821490'
    assert facts['factory_no'] == '41098223'
    assert facts['season'] == 'SS27'
    assert facts['style_no'] == '4320-51892-6103-007'
    assert facts['colour'] == 'FOREST GREEN'
    assert facts['country_of_origin'] == 'Bangladesh'
    assert facts['currency'] == 'USD'
    assert facts['product_description'] == 'FLEECE ZIP HOODIE'


def test_brightkids_deliveries_and_items():
    with load_pdf('brightkids_2450187.pdf') as pdf:
        facts = extract_brightkids(pdf.pages[0])

    assert len(facts['deliveries']) == 2
    assert len(facts['deliveries'][0]['items']) == 13
    assert len(facts['deliveries'][1]['items']) == 13

    first_item = facts['deliveries'][0]['items'][0]
    assert first_item['size'] == '3-4Y'
    assert first_item['cost_price'] == '5.85'
    assert first_item['order_qty'] == '95'
    assert first_item['cartons'] == '19'


# =====================================================================
# extract_george()
# =====================================================================

def test_george_1208545_header_and_deliveries():
    with load_pdf('george_1208545.pdf') as pdf:
        facts = extract_george(pdf)

    assert facts['po_number'] == '1208545'
    assert facts['vendor_no'] == '05344742'
    assert facts['factory_no'] == '36229061'
    assert facts['season'] == 'AW26'
    assert facts['style_no'] == '5810-30338-4877-003'
    assert facts['colour'] == 'LILAC'
    assert facts['country_of_origin'] == 'China'

    assert len(facts['deliveries']) == 3
    total_items = sum(len(d['items']) for d in facts['deliveries'])
    assert total_items == 33


def test_george_1208546_prepack():
    with load_pdf('george_1208546.pdf') as pdf:
        facts = extract_george(pdf)

    assert facts['po_number'] == '1208546'
    assert facts['vendor_no'] == '05344746'
    assert facts['factory_no'] == '36229609'

    assert len(facts['deliveries']) == 1
    assert len(facts['deliveries'][0]['items']) == 10

    assert len(facts['prepacks']) == 1
    assert len(facts['prepacks'][0]['sizes']) == 10


# =====================================================================
# extract_raj()
# =====================================================================

def test_raj_461_38901_header_fields():
    with load_pdf('raj_461-38901.pdf') as pdf:
        facts = extract_raj(pdf)

    assert facts['po_number'] == '461-38901'
    assert facts['supplier_no'] == '1007679'
    assert facts['destination_location'] == 'United Kingdom'
    assert facts['order_date'] == '14-APR-2026'
    assert facts['style_no'] == 'JL627409'
    assert facts['incoterm'] == 'FOB'
    assert facts['country_of_origin'] == 'Bangladesh'
    assert facts['season'] == 'AW'


def test_raj_461_38901_items():
    with load_pdf('raj_461-38901.pdf') as pdf:
        facts = extract_raj(pdf)

    assert len(facts['items']) == 5
    sizes = [item['size'] for item in facts['items']]
    assert sizes == ['10', '12', '8', '14', '16']
    for item in facts['items']:
        assert item['cost_price'] == '9.62'


def test_raj_461_38931_po_number():
    with load_pdf('raj_461-38931.pdf') as pdf:
        facts = extract_raj(pdf)

    assert facts['po_number'] == '461-38931'
    assert facts['supplier_no'] == '1007679'


# =====================================================================
# extract_from_pdf() end-to-end
# =====================================================================

@pytest.mark.parametrize("filename,expected_brand", [
    ('brightkids_2450187.pdf', 'BrightKids'),
    ('george_1208545.pdf', 'ThreadHaven'),
    ('george_1208546.pdf', 'ThreadHaven'),
    ('raj_461-38901.pdf', 'Raj International Sourcing'),
    ('raj_461-38931.pdf', 'Raj International Sourcing'),
])
def test_extract_from_pdf_success(filename, expected_brand):
    pdf_bytes = load_bytes(filename)
    result = extract_from_pdf(pdf_bytes, filename)

    assert result['success'] is True
    assert result['extracted_facts']['document_brand'] == expected_brand


def test_extract_from_pdf_invalid_input():
    result = extract_from_pdf(b'not a real pdf', 'fake.pdf')
    assert result['success'] is False


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-v']))
