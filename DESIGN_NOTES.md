# Design Notes — PO Extractor (Revised Submission)

Architecture decisions, assumptions, and tradeoffs for this revision, which
covers both the Node.js and Python implementations.

---

## Why This Revision Exists

The original submission used n8n as the pipeline orchestration layer, with
an AI model performing extraction inside an HTTP
Request node. I chose that approach with a non-developer, business-facing
audience in mind — a visual pipeline that's cheap to run and easy for an
operations team to understand and extend without writing code.

Feedback from the review was that the assessment is intended to evaluate
**the implementation directly through application code** — extraction,
transformation, and validation as plain code, without an automation platform
in the loop.

Taking that on board, and genuinely unsure which language would be most
relevant to see, I built **two complete implementations** instead of
guessing: Node.js + Express and Python + FastAPI. Both contain the full
pipeline logic directly in code, with no external platform, no AI, and no
API key. Both reuse the same React frontend. See the top-level `README.md`
for the full reasoning.

---

## CSV-Driven Transformation (Shared, Identical in Both Languages)

`transformer.js` (Node) and `transformer.py` (Python) are functionally
identical — the Python version is a near line-for-line port. Both read
`transformation_data.csv` at runtime on every execution:

- Adding a new supplier requires one CSV row — zero code changes
- Adding a new port mapping requires one CSV row — zero code changes
- The transformation rules are visible and editable by non-developers
- The CSV can be replaced with a database table in production with no code
  changes to the transformation logic itself

Rule types supported: `source_detection`, `header_default`, `pr_default`,
`item_default`, `division_lookup`, `vendor_lookup`, `incoterm_lookup`,
`country_lookup`, `port_lookup`, `destination_lookup`, `season_lookup`,
`factory_lookup`.

`item_default` (`apply_item_defaults` / `applyItemDefaults`) mirrors
`header_default`/`pr_default` exactly — it applies a constant to any item
field that's still empty after extraction and lookups. The current
`transformation_data.csv` has zero `item_default` rows, so this is currently
a no-op (verified: all 5 sample POs produce byte-for-byte identical output
with and without this function present). It's implemented generically so
that adding a row of this type in future requires no code change in either
implementation.

**Known limitation**: the spec describes composite-key lookup rows (matching
on, e.g., `Style No + Season` together). No row in the current
`transformation_data.csv` uses this form, so it isn't exercised by the 5
sample POs. `apply_lookup()` / `applyLookup()` currently matches a single
`source_value`. Supporting a `|`-delimited composite key would be a small,
contained extension in either language if a future CSV row needed it.

---

## Status and Issues Design (Shared) — The Raj `factory_id` Story

The validator never guesses. When a required field can't be resolved:

1. The field is left as an empty string
2. An entry is added to `issues` naming the exact section/field
3. `status` becomes `needs_review`

**A concrete example surfaced by this revision**: the original AI submission
produced `items: []` for Raj POs, and `status: artifact_ready` — because the
old validator's array checks used `.forEach()`, which silently does nothing
on an empty array. Both validators in this revision explicitly flag an empty
array as an issue. Since both extractors now populate `items[]` for Raj (5
real items), the validator runs its per-item checks and correctly flags
`factory_id` as unresolvable — because `transformation_data.csv` has no
`factory_lookup` rule for any Raj factory number.

The result is `needs_review` instead of `artifact_ready` for Raj — which is
**more correct**, not a regression. It surfaces a genuine data gap (no
factory mapping exists for Raj suppliers) that the previous validator
happened to never check. This behaviour is identical in both
implementations and is covered by a regression test in each.

---

## Extraction Approach Per Layout — Node vs Python

Both extractors produce the exact same `extracted_facts` shape, verified to
produce **byte-for-byte identical final JSON** for all 5 sample POs. The
extraction *method* differs because `pdf-parse` (Node) and `pdfplumber`
(Python) expose the PDF differently.

### BrightKids — simple flat table

- **Node (`pdf-parse`)**: text comes out space-separated
  (`"3-4Y 5078912340011 5.85 8.00 95 19"`); items extracted via regex.
- **Python (`pdfplumber`)**: `extract_tables()` returns this as a clean
  6-column grid directly — `['3-4Y', '5078912340011', '5.85', '8.00', '95',
  '19']` per row. No regex needed for items; just iterate rows, tracking
  `"Delivery N..."` marker rows.

Both approaches are reliable here; Python's is simpler.

### George (ThreadHaven) — multi-page delivery splits / prepacks

- **Node**: header fields and items both extracted via regex from page
  text. Header regex uses boundary patterns (e.g. `Product Description
  (.+?)\s*QC Status`) since label/value pairs share lines with adjacent
  fields.
- **Python**: header fields come from a clean key-value table on page 1
  (`['Purchase Order Number', '1208545', ...]`) — no regex needed for
  headers. **Items**, however, use the *same regex approach as Node* —
  `pdfplumber`'s table detection is unreliable for this particular item
  table (most cells come back `None`).

One pdfplumber-specific quirk: the two-line prepack cell `"10PC PRE-\nPACK"`
is rendered as `"10PC PRE-"` immediately followed by that row's numeric
columns, with `"PACK"` pushed to a separate line *after* the whole row — so
the Python regex matches on `"10PC PRE-"` alone, vs Node's
`"10PC PRE-\nPACK"`.

### Raj International — ratio pack table (the hardest layout)

This is where the two libraries diverge most:

- **Node (`pdf-parse`)**: extracts text in the PDF's internal object order,
  not visual reading order. Labels (`"Style No :"`, `"Size"`, `"Colour"`)
  and their values appear in entirely separate, duplicated blocks. What
  *is* extractable reliably: the 5 ratio-pack sizes and the per-unit cost
  appear as parallel, consistently-ordered arrays. `extractRaj()` extracts
  these positionally — 5 consecutive size values following 5 consecutive
  `"BLACK"` colour values — and zips them into 5 items. This works and is
  tested, but is more fragile to layout changes than a true table-aware
  parser.

- **Python (`pdfplumber`)**: this is a clear win. Header fields are clean
  `"Label : Value"` lines in `extract_text()` — `Supplier No. : 1007679`,
  `Country of Origin : Bangladesh`, `Lading Port : Chittagong - Bangladesh`,
  `Purchase Terms : FOB`, `Order Create Date : 14-APR-2026` — each extracted
  with a simple `Label\s*:\s*(.+)` regex. Items come from a
  `Colour | Size | Break up Qty | ... | Unit cost` table — one per ratio
  pack (Pack A: sizes 10/12/8, Pack B: sizes 14/16) — read directly row by
  row, with size and unit cost already together in the same row. No
  positional-array workaround needed.

This was the clearest case where the choice of PDF library genuinely
mattered, and is a good illustration of why building both implementations
was useful: it surfaced a real tradeoff that a single implementation
wouldn't have shown.

---

## A Real Debugging Story — `pdf-parse` v1 vs v2 (Node only)

Worth documenting because it shaped the final Node extraction code:

`pdf-parse@1.1.1` bundles a pdf.js build from ~2018. On Node v24, this throws
`UnknownErrorException: bad XRef entry` for the BrightKids PDF — even though
the exact same code works fine on Node v22. This is a real compatibility
trap: the pipeline would work on the developer's machine and fail on an
evaluator's machine running a different Node version, with no obvious cause.

The fix was to move to `pdf-parse@2.x` (actively maintained, modern pdf.js).
This had a side effect: v1 concatenates table cells with no separator
(`"3-4Y50789123400115.858.009519"`), requiring a digit-splitting heuristic to
separate `order_qty` from `cartons`. v2 separates cells with spaces
(`"3-4Y 5078912340011 5.85 8.00 95 19"`) — which is actually **easier** to
parse and removes the need for that heuristic entirely.

---

## Assumptions Made (Both Implementations)

1. **One PO per PDF** — as stated in the spec.
2. **FOB is the only incoterm** in the sample set — the CSV `incoterm_lookup`
   handles this; a new incoterm would need a new CSV row plus (if the printed
   text differs) a small extractor change.
3. **Season year inference for Raj** — Raj POs print only `"AW"`. The CSV
   `season_lookup` rule maps `"AW"` → `"AW26"`. A future `"AW27"` PO would
   need a new CSV row.
4. **USD as the only currency** in the sample set — handled via
   `pr_default` / direct extraction.
5. **Layout detection is marker-based, not exhaustive** — both
   `detectLayout()` implementations check for known strings (`"BrightKids"`,
   `"Split A"`, etc.). A genuinely new layout returns `"unknown"` and the
   pipeline reports a clear `failed` status with an explanatory message,
   rather than attempting to guess.
6. **George prepack row is excluded from `items[]`** — the `"10PC
   PRE-PACK"` row represents the combo pack itself, not an individual
   size/colour line; it's used to populate `prepacks[]` instead.

---

## Tradeoffs

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Pipeline | Plain Express / FastAPI routes | n8n workflow | Spec requires logic checkable directly in application code |
| Extraction | Pattern-matching / table extraction (no AI) | AI (already demonstrated) | Demonstrates non-AI extraction skill in two languages |
| Raj ratio-pack parsing | Node: positional arrays; Python: direct table rows | Single shared approach | `pdfplumber` has table detection `pdf-parse` lacks; kept as an honest, documented comparison rather than forcing parity |
| Transformation config | CSV file (unchanged) | Hardcoded rules | Data-driven, editable without deployment |
| Frontend | React + Vite (shared, unchanged) | Separate frontends | One frontend, auto-detects either backend |
| Testing | Plain `assert` (Node) / `pytest` (Python) | Jest / unittest | 50 tests per implementation, no heavy framework dependency |

---

## What I Would Add for Production

1. **Persistent storage** — save extracted POs to a database (PostgreSQL) so
   users can retrieve past extractions. Explicitly out of scope per the spec
   for this MVP.
2. **A pluggable layout registry** — instead of a `switch`/`if` chain in
   `detectLayout()`, a list of `{detector, extractor}` pairs that new
   layouts can register into, so adding a customer never touches existing
   layout code.
3. **Table-aware PDF parsing for Node** — evaluate `pdfjs-dist` directly
   (with its layout/structure APIs) to bring Raj-style table reconstruction
   to the Node implementation, closing the gap with the Python/pdfplumber
   approach.
4. **CI** — GitHub Actions workflow to run both test suites (`npm test` and
   `pytest`) on every push.
5. **Multi-PO batch processing** — accept multiple PDFs and process them in
   parallel.
6. **ERP push endpoint** — a new endpoint that posts the validated JSON to a
   target ERP API, completing the end-to-end flow beyond "download JSON".
7. **Factory mapping completeness** — add `factory_lookup` rows for Raj's
   factory numbers (once the printed factory number can be reliably located)
   to resolve the current `needs_review` status for those POs.