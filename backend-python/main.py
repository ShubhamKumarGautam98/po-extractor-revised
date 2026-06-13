"""
PO Extractor backend - FastAPI implementation.

No AI, no API key, no external services. Extraction, transformation and
validation are all plain Python functions called from this single endpoint.
"""

import base64

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.extractor import extract_from_pdf
from services.transformer import transform
from services.validator import validate

app = FastAPI(title="PO Extractor (Python)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractRequest(BaseModel):
    pdf_base64: str
    filename: str = "unknown.pdf"


@app.get("/")
def health_check():
    return {"status": "ok", "message": "PO Extractor backend is running"}


@app.post("/api/extract")
def extract(request: ExtractRequest):
    if not request.pdf_base64:
        return {
            "status": "failed",
            "purchase_order": None,
            "issues": [{
                "section": "request",
                "field": "pdf_base64",
                "message": "No PDF data received"
            }]
        }

    try:
        pdf_bytes = base64.b64decode(request.pdf_base64)
    except Exception as error:
        return {
            "status": "failed",
            "purchase_order": None,
            "issues": [{
                "section": "request",
                "field": "pdf_base64",
                "message": f"Could not decode base64 PDF data: {error}"
            }]
        }

    safe_filename = request.filename or "unknown.pdf"

    # Step 1: Extract observable facts from the PDF (pdfplumber + pattern matching)
    extraction_result = extract_from_pdf(pdf_bytes, safe_filename)

    # Step 2: Transform facts using CSV-driven rules
    transform_result = transform(extraction_result)

    # Step 3: Validate and flag missing fields
    validation_result = validate(transform_result)

    # Ensure source_file always reflects the actual uploaded filename
    if validation_result.get("purchase_order"):
        validation_result["purchase_order"]["source_file"] = safe_filename

    return validation_result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
