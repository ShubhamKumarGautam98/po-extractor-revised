// =====================================================================
// Backend auto-detection
//
// This project ships TWO interchangeable backend implementations:
//   - Node.js + Express   -> http://localhost:3000
//   - Python + FastAPI    -> http://localhost:8000
//
// Both expose an identical /api/extract contract and return identical
// JSON. The frontend probes both on the first request and uses whichever
// one responds - no manual configuration needed. If you restart with a
// different backend running, just reload the page.
// =====================================================================
const BACKEND_CANDIDATES = [
  'http://localhost:3000',
  'http://localhost:8000'
];

let cachedBackend = null;

async function detectBackend() {
  if (cachedBackend) return cachedBackend;

  for (const base of BACKEND_CANDIDATES) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        cachedBackend = base;
        return base;
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    'No backend found on port 3000 (Node) or 8000 (Python). ' +
    'Make sure one of the backends is running.'
  );
}

// Convert PDF file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Send PDF to whichever backend is running for processing
export async function extractPO(file) {
  try {
    const pdf_base64 = await fileToBase64(file);
    const base = await detectBackend();

    const response = await fetch(`${base}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_base64,
        filename: file.name
      })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    return {
      status: 'failed',
      purchase_order: null,
      issues: [
        {
          section: 'network',
          field: 'backend',
          message: error.message
        }
      ]
    };
  }
}

// Export final JSON as downloadable file
export function downloadJSON(data, filename) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'po_export.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}