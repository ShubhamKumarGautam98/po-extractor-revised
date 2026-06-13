require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { extractFromPDF } = require('./services/extractor');
const { transform } = require('./services/transformer');
const { validate } = require('./services/validator');

const app = express();
const PORT = process.env.PORT || 3000;

// -- Middleware --
app.use(cors());
app.use(express.json({ limit: '20mb' })); // PDFs as base64 can be large

// -- Health check --
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'PO Extractor backend is running' });
});

// -- MAIN PIPELINE ENDPOINT --
// Receives: { pdf_base64, filename }
// Returns:  { status, purchase_order, issues }
app.post('/api/extract', async (req, res) => {
  try {
    const { pdf_base64, filename } = req.body;
    console.log('--- DEBUG: Received request ---');
    console.log('filename:', filename);
    console.log('pdf_base64 length:', pdf_base64 ? pdf_base64.length : 'undefined');
    console.log('pdf_base64 starts with:', pdf_base64 ? pdf_base64.slice(0, 30) : 'N/A');
    console.log('pdf_base64 ends with:', pdf_base64 ? pdf_base64.slice(-30) : 'N/A');

    if (!pdf_base64) {
      return res.status(400).json({
        status: 'failed',
        purchase_order: null,
        issues: [
          {
            section: 'request',
            field: 'pdf_base64',
            message: 'No PDF data received'
          }
        ]
      });
    }

    const safeFilename = filename || 'unknown.pdf';

    // Step 1: Extract observable facts from the PDF using pattern matching
    const extractionResult = await extractFromPDF(pdf_base64, safeFilename);

    // Step 2: Transform facts using CSV-driven rules
    const transformResult = transform(extractionResult);

    // Step 3: Validate and flag missing fields
    const validationResult = validate(transformResult);

    // Ensure source_file always reflects the actual uploaded filename
    if (validationResult.purchase_order) {
      validationResult.purchase_order.source_file = safeFilename;
    }

    return res.json(validationResult);

  } catch (error) {
    return res.status(500).json({
      status: 'failed',
      purchase_order: null,
      issues: [
        {
          section: 'pipeline',
          field: 'server',
          message: error.message || 'Internal server error'
        }
      ]
    });
  }
});

app.listen(PORT, () => {
  console.log(`PO Extractor backend running on http://localhost:${PORT}`);
});