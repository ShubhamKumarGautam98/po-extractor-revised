# PO Extractor — Two Implementations

A web application that extracts, transforms, and validates Purchase Order
data from PDF documents — **without any AI, OCR, external API, or API key**.

This submission includes **two complete backend implementations** of the
same pipeline, in two languages, sharing one React frontend:

| | Language | PDF library | Extraction approach |
|---|---|---|---|
| [`backend-node/`](./backend-node) | Node.js + Express | `pdf-parse` v2 | Regex pattern-matching, layout-specific |
| [`backend-python/`](./backend-python) | Python + FastAPI | `pdfplumber` | Table extraction + pattern-matching, layout-specific |

Both implementations:
- Read `transformation_data.csv` at runtime via the same CSV-driven
  transformation engine (ported 1:1 between the two languages)
- Validate against the same `field_schema.json`
- Produce **byte-for-byte identical JSON output** for all 5 sample POs
- Pass **54 unit tests** each (108 total), including dedicated tests for
  composite-key CSV lookups using the spec's own worked example
- Require zero configuration, zero API keys, zero external services

Setup instructions for both implementations are below; see `DESIGN_NOTES.md`
for the full architecture reasoning, including a side-by-side comparison of
how each implementation handles each PDF layout.

---

## Quick Start

### 1. Run a backend (choose one)

**Node.js:**
```bash
cd backend-node
npm install
npm start
```
Runs on `http://localhost:3000`

**Python:**
```bash
cd backend-python
pip install -r requirements.txt
python main.py
```
Runs on `http://localhost:8000`

### 2. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3001`.

### 3. Switching between backends — automatic

The frontend **auto-detects** which backend is running. On the first PDF
upload, `frontend/src/api.js` probes `http://localhost:3000` (Node) and
`http://localhost:8000` (Python), in that order, and uses whichever one
responds. The result is cached for the session.

No configuration is needed — simply have one backend running (either one)
and upload a file. To switch from one to the other: stop the running
backend, start the other one, then refresh the browser page (to clear the
cached detection) before uploading again.

Both backends expose an identical `/api/extract` contract and return
identical JSON for the 5 sample POs — this auto-detection works because the
two implementations are true drop-in replacements for each other.

---

## Why Two Implementations?

My original submission used n8n with AI-based extraction. I chose that
approach with a non-developer, business-facing audience in mind — a visual
pipeline that's cheap to run and easy for an operations team to understand
and extend without writing code.

After review, the team's feedback was that the assessment is meant to
evaluate the logic — extraction, transformation, and validation — directly
within application code, rather than through an automation platform.

Taking that feedback on board, my honest position was: I genuinely wasn't
sure which language the team would want to see this implemented in. Rather
than guess, I built **two complete backend implementations** — one in
Node.js, one in Python — each containing the full extraction, transformation,
and validation logic directly in code, with no external platform involved.
Both reuse the **same React frontend** I built originally, just pointed at a
different backend.

This felt like the most useful way to respond to the feedback: instead of a
single rewrite that might still miss the mark on language preference, two
working implementations let the team see the actual logic in both, in
whichever language is more relevant to how this would be evaluated or
maintained — and hopefully gives a fuller picture of what I can bring to the
team.

A side effect worth mentioning: building both surfaced a genuine technical
comparison between the two PDF libraries. `pdfplumber`'s table extraction
handles the hardest layout (Raj's ratio-pack table) more
naturally than `pdf-parse`'s text-stream output. See `DESIGN_NOTES.md` for
the full writeup of this tradeoff.

---

---

## How Extraction Works (No AI)

Both backends detect which of three known PDF layouts the document uses,
then extract observable facts — PO number, vendor/supplier numbers, season,
colour, style number, sizes, prices, quantities, ports, etc. — using
deterministic code, not AI.

| Layout | Customer | Detection | Node (`pdf-parse`) | Python (`pdfplumber`) |
|---|---|---|---|---|
| `brightkids` | BrightKids | `"BrightKids"` in text | Regex over space-separated text | Direct table iteration (clean 6-column grid) |
| `george` | ThreadHaven (George) | `"Purchase Order Number"` + `"Split A"` | Regex (header + items) | Table for header (clean key-value pairs); regex for items |
| `raj` | Raj International Sourcing | `"International Sourcing"` / `"Raj Limited"` | Positional-array extraction from jumbled text | Clean `"Label : Value"` text + direct table rows |

The output shape (`extracted_facts`) is identical across both, so the shared
transformation and validation logic needs no layout-specific knowledge. See
`DESIGN_NOTES.md` for the full per-layout breakdown and the genuine
Node-vs-Python tradeoff this surfaced for the Raj layout.

## Sample Outputs

`sample_outputs/` contains the 5 pre-processed JSON outputs. Both backends
produce these exact files — verified byte-for-byte identical during
development.

| File | Customer | Status | Notes |
|------|----------|--------|-------|
| `PO_2450187.json` | BrightKids | needs_review | 2 deliveries, 26 items. Destination not printed on document. |
| `PO_1208545.json` | ThreadHaven (George) | needs_review | 3 deliveries, 33 items. Destination not printed on document. |
| `PO_1208546.json` | ThreadHaven (George) | needs_review | Prepack PO, 10 items + 1 prepack entry. |
| `PO_461-38901.json` | Raj International | needs_review | Ratio pack, 5 items. `factory_id` not resolvable — see design notes. |
| `PO_461-38931.json` | Raj International | needs_review | Same as above. |

---

## Project Structure

```
backend-node/        # Node.js + Express + pdf-parse implementation
├── server.js
├── services/
├── config/
└── tests/

backend-python/       # Python + FastAPI + pdfplumber implementation
├── main.py
├── services/
├── config/
└── tests/

frontend/             # Shared React + Vite frontend
└── src/
    ├── api.js        # Backend auto-detection - see "Quick Start" above
    └── components/

sample_outputs/       # Pre-processed JSON for all 5 sample POs
README.md             # This file - setup and overview for both implementations
DESIGN_NOTES.md       # Architecture reasoning, assumptions, tradeoffs (covers both)
```

---

## AI / OCR Policy

**No AI and no OCR are used in either implementation.** All extraction is
deterministic pattern-matching / table-extraction code, with no network
calls. See `DESIGN_NOTES.md` for the full extraction approach for each
implementation.

---

## Running Tests

```bash
# Node
cd backend-node && npm test          # 54 passed

# Python
cd backend-python && python -m pytest tests/ -v    # 54 passed
```