"""
PO EXTRACTOR - pure code, pdfplumber-based extraction (no AI / no API key)

Reads a PDF using pdfplumber and extracts observable facts using a mix of
table extraction and pattern matching. Three layouts are supported, matching
the three customer formats in the sample documents:

  - BrightKids  : simple flat table, items extracted from a clean pdfplumber
                  table (Size/Barcode/Cost/Retail/Order Qty/Cartons)
  - ThreadHaven : multi-page delivery splits / prepacks (George POs).
                  Header fields come from a clean key-value table; items are
                  extracted via regex from the page text (pdfplumber's table
                  detection is unreliable for this item table layout).
  - Raj International Sourcing : ratio-pack table layout. Header fields are
                  clean "Label : Value" pairs in the page text; items come
                  from the Colour/Size/.../Unit cost tables that pdfplumber
                  extracts cleanly for this layout.

The output shape (extracted_facts) matches the original AI-based extractor's
output, so transformer.py and validator.py do not need any layout-specific
knowledge.
"""

import io
import re
import pdfplumber


def _fmt_price(value):
    """Format a price string like '9.6200' -> '9.62'."""
    try:
        return f'{float(value):.2f}'
    except (TypeError, ValueError):
        return value or ''


# =====================================================================
# LAYOUT 1 - BrightKids
# =====================================================================
def extract_brightkids(page):
    text = page.extract_text()
    tables = page.extract_tables()

    document_brand = text.strip().split('\n')[0].strip()
    po_number = re.search(r'Purchase Order Number\s*(\d+)', text).group(1)
    vendor_no = re.search(r'\nVendor\s*(\d+)', text).group(1)
    factory_no = re.search(r'\nFactory\s*(\d+)', text).group(1)
    product_description = re.search(r'Product Description\s*(.+?)\s*Currency Code', text).group(1).strip()
    colour = re.search(r'Colour\s*(.+?)\s*Port of Departure', text).group(1).strip()
    season = re.search(r'Season\s+([A-Z]{2}\d{2})', text).group(1)
    style_no = re.search(r'Product Ident\s*([\d-]+)', text).group(1)
    currency = re.search(r'Currency Code\s*([A-Z]{3})', text).group(1)
    country_of_origin = re.search(r'Country of Origin\s*(.+?)\n', text).group(1).strip()
    port_of_departure = re.search(r'Port of Departure\s*(.+?)\n', text).group(1).strip()
    payment_terms_m = re.search(r'Payment Terms\s*(Net Due \d+ days)', text)
    payment_terms = payment_terms_m.group(1) if payment_terms_m else ''

    # Items table: rows are [Size, Barcode, Cost, Retail, Order Qty, Cartons]
    # with "Delivery N Shipment Date: ..." marker rows separating deliveries
    item_table = None
    for table in tables:
        if table and len(table[0]) == 6 and table[1] == ['Size', 'Barcode', 'Cost (USD)', 'Retail (USD)', 'Order Qty', 'Cartons']:
            item_table = table
            break

    deliveries = []
    current = None
    if item_table:
        for row in item_table:
            col0 = row[0] or ''
            m = re.match(r'Delivery (\d+) Shipment Date:\s*([A-Za-z0-9-]+)', col0)
            if m:
                if current:
                    deliveries.append(current)
                current = {'delivery_number': m.group(1), 'shipment_date': m.group(2), 'items': []}
                continue
            if col0 in ('Size', 'TOTALS', ''):
                continue
            if re.match(r'\d{1,2}-\d{1,2}Y', col0) and current is not None:
                current['items'].append({
                    'size': row[0],
                    'barcode': row[1],
                    'cost_price': row[2],
                    'retail_price': row[3],
                    'order_qty': row[4],
                    'cartons': row[5]
                })
        if current:
            deliveries.append(current)

    return {
        'document_brand': document_brand,
        'po_number': po_number,
        'vendor_no': vendor_no,
        'supplier_no': '',
        'factory_no': factory_no,
        'style_no': style_no,
        'product_description': product_description,
        'season': season,
        'colour': colour,
        'currency': currency,
        'country_of_origin': country_of_origin,
        'port_of_departure': port_of_departure,
        'lading_port': '',
        'destination_location': '',
        'order_date': '',
        'payment_terms': payment_terms,
        'incoterm': '',
        'items': [],
        'deliveries': deliveries,
        'prepacks': [],
        'ratio_packs': [],
        'missing_fields': []
    }


# =====================================================================
# LAYOUT 2 - ThreadHaven / George (delivery splits + prepacks)
# =====================================================================
def extract_george(pdf):
    pages_text = [page.extract_text() for page in pdf.pages]
    full_text = '\n'.join(pages_text)

    # Header fields from the clean key-value table on page 1
    header_table = pdf.pages[0].extract_tables()[0]
    kv = {}
    for row in header_table:
        if row[0] and row[1]:
            kv[row[0]] = row[1]
        if len(row) > 2 and row[2] and row[3]:
            kv[row[2]] = row[3]

    document_brand = 'ThreadHaven'
    po_number = kv.get('Purchase Order Number', '')
    vendor_no = kv.get('Vendor', '')
    factory_no = kv.get('Factory', '')
    product_description = kv.get('Product Description', '')
    colour = kv.get('Colour', '')
    season = kv.get('Season', '')
    style_no = kv.get('Product Ident', '')
    currency = kv.get('Currency Code', '')
    country_of_origin = kv.get('Country of Origin', '')
    port_of_departure = kv.get('Port of Departure', '')
    payment_terms = kv.get('Payment Terms', '')

    # Vendor/Factory live in a second row of the header table on page 1,
    # but to be safe also try the page text directly
    if not vendor_no:
        m = re.search(r'\nVendor\s*(\d+)', full_text)
        vendor_no = m.group(1) if m else ''
    if not factory_no:
        m = re.search(r'\nFactory\s*(\d+)', full_text)
        factory_no = m.group(1) if m else ''

    # Delivery markers (dedupe across page breaks)
    delivery_matches = re.findall(r'Delivery (\d+) Split A\nShipment Date:\s*([A-Za-z0-9 ]+?)\s*-\n', full_text)
    seen_deliveries = {}
    for num, date in delivery_matches:
        if num not in seen_deliveries:
            seen_deliveries[num] = date.strip()

    # Item rows from text: Size + 4 numeric columns + cost + retail.
    # Note: pdfplumber renders the prepack cell's two lines as "10PC PRE-"
    # immediately followed by the row's numeric columns, with "PACK" pushed
    # to a separate line after the whole row - so we match "10PC PRE-" alone.
    item_row_regex = re.compile(r'(\d{1,2}-\d{1,2}Y|10PC PRE-)(?:\s+\d+){4}\s+(\d+\.\d{2})\s+(\d+\.\d{2})')
    all_items_raw = [
        {'size': m.group(1).replace('\n', ' ').strip(), 'cost_price': m.group(2), 'retail_price': m.group(3)}
        for m in item_row_regex.finditer(full_text)
    ]

    is_prepack = '10PC PRE-' in full_text or 'PREPACK' in full_text
    all_items = [it for it in all_items_raw if 'PRE' not in it['size']]

    delivery_nums = list(seen_deliveries.keys())
    deliveries = []

    if len(delivery_nums) > 1 and len(all_items) % len(delivery_nums) == 0:
        per_delivery = len(all_items) // len(delivery_nums)
        for i, num in enumerate(delivery_nums):
            deliveries.append({
                'delivery_number': num,
                'shipment_date': seen_deliveries[num],
                'items': all_items[i * per_delivery:(i + 1) * per_delivery]
            })
    else:
        num = delivery_nums[0] if delivery_nums else '1'
        deliveries.append({
            'delivery_number': num,
            'shipment_date': seen_deliveries.get(num, ''),
            'items': all_items
        })

    prepacks = []
    if is_prepack:
        prepacks = [{
            'prepack_id': '1',
            'sizes': [{'size': it['size']} for it in all_items]
        }]

    return {
        'document_brand': document_brand,
        'po_number': po_number,
        'vendor_no': vendor_no,
        'supplier_no': '',
        'factory_no': factory_no,
        'style_no': style_no,
        'product_description': product_description,
        'season': season,
        'colour': colour,
        'currency': currency,
        'country_of_origin': country_of_origin,
        'port_of_departure': port_of_departure,
        'lading_port': '',
        'destination_location': '',
        'order_date': '',
        'payment_terms': payment_terms,
        'incoterm': '',
        'items': [],
        'deliveries': deliveries,
        'prepacks': prepacks,
        'ratio_packs': [],
        'missing_fields': []
    }


# =====================================================================
# LAYOUT 3 - Raj International Sourcing (ratio pack table)
# =====================================================================
def extract_raj(pdf):
    pages_text = [page.extract_text() for page in pdf.pages]
    full_text = '\n'.join(pages_text)

    all_tables = []
    for page in pdf.pages:
        all_tables.extend(page.extract_tables())

    document_brand = 'Raj International Sourcing'

    po_match = re.search(r'Purchase Order\s+(\d{3}-\d{5})', full_text) or \
        re.search(r'Purchase Order\s*:\s*(\d{3}-\d{5})', full_text)
    po_number = po_match.group(1) if po_match else ''

    supplier_match = re.search(r'Supplier No\.\s*:\s*(\d+)', full_text)
    supplier_no = supplier_match.group(1) if supplier_match else ''

    dest_match = re.search(r'Destination Location\s*:\s*(.+)', full_text)
    destination_location = dest_match.group(1).strip() if dest_match else ''

    country_match = re.search(r'Country of Origin\s*:\s*(.+)', full_text)
    country_of_origin = country_match.group(1).strip() if country_match else ''

    lading_match = re.search(r'Lading Port\s*:\s*(.+)', full_text)
    lading_port = lading_match.group(1).strip() if lading_match else ''

    incoterm_match = re.search(r'Purchase Terms\s*:\s*(\w+)', full_text)
    incoterm = incoterm_match.group(1) if incoterm_match else ''

    order_date_match = re.search(r'Order Create Date\s*:\s*([A-Za-z0-9-]+)', full_text)
    order_date = order_date_match.group(1) if order_date_match else ''

    # Style No / Season Code / Product Description / unit cost - found inside
    # a 4x3 "VPN / Style No / 24 Char Description / Brand" table per ratio pack
    style_no = ''
    season = ''
    product_description = ''

    for table in all_tables:
        for row in table:
            for cell in (row or []):
                if not cell:
                    continue
                if not style_no and 'Style No' in cell:
                    m = re.search(r'Style No\s*:\s*(\S+)', cell)
                    if m:
                        style_no = m.group(1)
                if not season and 'Season Code' in cell:
                    m = re.search(r'Season Code\s*:\s*(\w+)', cell)
                    if m:
                        season = m.group(1)
                if not product_description and 'Product Description' in cell:
                    m = re.search(r'Product Description\s*:\s*(.+?)(?:\s+Average|$)', cell)
                    if m:
                        product_description = m.group(1).strip()

    # Items: Colour/Size/.../Unit cost tables (one per ratio pack)
    items = []
    for table in all_tables:
        header = table[0] if table else None
        if header and header[0] == 'Colour' and len(header) > 1 and header[1] == 'Size':
            unit_cost_idx = header.index('Unit cost') if 'Unit cost' in header else None
            for row in table[1:]:
                if row[0] == 'BLACK':
                    cost_raw = row[unit_cost_idx] if unit_cost_idx is not None else ''
                    cost_match = re.search(r'USD\s*([\d.]+)', cost_raw or '')
                    items.append({
                        'size': row[1],
                        'cost_price': _fmt_price(cost_match.group(1)) if cost_match else ''
                    })

    ratio_packs = [{
        'pack_name': 'RATIO PACK',
        'sizes': [{'size': it['size'], 'cost_price': it['cost_price']} for it in items]
    }] if items else []

    return {
        'document_brand': document_brand,
        'po_number': po_number,
        'vendor_no': '',
        'supplier_no': supplier_no,
        'factory_no': '',
        'style_no': style_no,
        'product_description': product_description,
        'season': season,
        'colour': 'BLACK' if items else '',
        'currency': 'USD',
        'country_of_origin': country_of_origin,
        'port_of_departure': lading_port,
        'lading_port': lading_port,
        'destination_location': destination_location,
        'order_date': order_date,
        'payment_terms': '',
        'incoterm': incoterm,
        'items': items,
        'deliveries': [],
        'prepacks': [],
        'ratio_packs': ratio_packs,
        'missing_fields': []
    }


# =====================================================================
# LAYOUT DETECTION
# =====================================================================
def detect_layout(text):
    if 'BrightKids' in text:
        return 'brightkids'
    if 'International Sourcing' in text or 'Raj Limited' in text:
        return 'raj'
    if 'Purchase Order Number' in text and 'Split A' in text:
        return 'george'
    return 'unknown'


# =====================================================================
# MAIN EXTRACTION FUNCTION
# =====================================================================
def extract_from_pdf(pdf_bytes, filename):
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            first_page_text = pdf.pages[0].extract_text() or ''
            full_text = '\n'.join((page.extract_text() or '') for page in pdf.pages)

            layout = detect_layout(full_text if 'Purchase Order Number' in full_text else first_page_text)
            # detect_layout needs the right text depending on layout; use full_text generally
            layout = detect_layout(full_text)

            if layout == 'brightkids':
                facts = extract_brightkids(pdf.pages[0])
            elif layout == 'george':
                facts = extract_george(pdf)
            elif layout == 'raj':
                facts = extract_raj(pdf)
            else:
                return {
                    'success': False,
                    'filename': filename,
                    'error': f'Could not detect a known document layout for {filename}',
                    'extracted_facts': None
                }

        return {
            'success': True,
            'filename': filename,
            'extracted_facts': facts
        }
    except Exception as error:
        return {
            'success': False,
            'filename': filename,
            'error': str(error),
            'extracted_facts': None
        }
