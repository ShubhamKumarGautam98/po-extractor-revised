import { useState, useRef } from "react";

const S = {
  page: { minHeight: "100vh", background: "#F8FAFC", display: "flex", flexDirection: "column" },
  nav: { background: "#FFFFFF", borderBottom: "1px solid #E2E8F0", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", flexShrink: 0 },
  navLeft: { display: "flex", alignItems: "center", gap: "10px" },
  navIcon: { width: "30px", height: "30px", background: "#1D6FE8", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center" },
  navName: { fontSize: "15px", fontWeight: "500", color: "#0F172A" },
  navPill: { fontSize: "11px", padding: "3px 10px", background: "#EFF6FF", color: "#1D4ED8", borderRadius: "20px", fontWeight: "500", border: "1px solid #BFDBFE" },
  steps: { background: "#FFFFFF", borderBottom: "1px solid #E2E8F0", padding: "0 24px", display: "flex", alignItems: "center", flexShrink: 0 },
  body: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" },
  card: { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "32px", width: "100%", maxWidth: "500px" },
  cardTitle: { fontSize: "18px", fontWeight: "500", color: "#0F172A", marginBottom: "4px" },
  cardSub: { fontSize: "13px", color: "#64748B", marginBottom: "24px" },
  dropzone: { border: "1.5px dashed #CBD5E1", borderRadius: "8px", padding: "36px 24px", textAlign: "center", background: "#F8FAFC", cursor: "pointer" },
  dropzoneActive: { border: "1.5px dashed #1D6FE8", borderRadius: "8px", padding: "36px 24px", textAlign: "center", background: "#EFF6FF", cursor: "pointer" },
  dropIcon: { width: "44px", height: "44px", background: "#EFF6FF", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" },
  dropTitle: { fontSize: "14px", fontWeight: "500", color: "#0F172A", marginBottom: "4px" },
  dropSub: { fontSize: "12px", color: "#94A3B8" },
  fileSelected: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "#EFF6FF", borderRadius: "8px", marginTop: "16px", border: "1px solid #BFDBFE" },
  fileName: { fontSize: "13px", fontWeight: "500", color: "#1D4ED8", flex: 1 },
  fileSize: { fontSize: "11px", color: "#64748B" },
  btnPrimary: { width: "100%", marginTop: "16px", padding: "10px", background: "#1D6FE8", color: "#FFFFFF", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "500", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" },
  btnDisabled: { width: "100%", marginTop: "16px", padding: "10px", background: "#CBD5E1", color: "#FFFFFF", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "500", cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" },
  formats: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "14px" },
  formatTag: { fontSize: "11px", color: "#64748B", background: "#F1F5F9", padding: "3px 8px", borderRadius: "4px" },
  error: { fontSize: "12px", color: "#DC2626", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", padding: "8px 12px", marginTop: "12px" },
  loadingCard: { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "40px 32px", width: "100%", maxWidth: "440px", textAlign: "center" },
  spinner: { width: "48px", height: "48px", border: "3px solid #EFF6FF", borderTop: "3px solid #1D6FE8", borderRadius: "50%", margin: "0 auto 20px", animation: "spin 0.8s linear infinite" },
  loadTitle: { fontSize: "16px", fontWeight: "500", color: "#0F172A", marginBottom: "6px" },
  loadSub: { fontSize: "13px", color: "#64748B", marginBottom: "24px" },
  loadSteps: { textAlign: "left", display: "flex", flexDirection: "column", gap: "10px" },
};

function Step({ num, label, state }) {
  const isActive = state === "active";
  const isDone = state === "done";
  const color = isDone ? "#16A34A" : isActive ? "#1D6FE8" : "#94A3B8";
  const circleBg = isDone ? "#DCFCE7" : "transparent";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "12px 16px 12px 0", fontSize: "12px", color, position: "relative", whiteSpace: "nowrap", borderBottom: isActive ? "2px solid #1D6FE8" : "2px solid transparent", marginBottom: "-1px" }}>
      <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `1.5px solid ${color}`, background: circleBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "500", color, flexShrink: 0 }}>
        {isDone ? "✓" : num}
      </div>
      {label}
    </div>
  );
}

function LoadingStep({ label, state }) {
  const color = state === "done" ? "#16A34A" : state === "active" ? "#1D6FE8" : "#94A3B8";
  const dotBg = state === "done" ? "#16A34A" : state === "active" ? "#1D6FE8" : "#CBD5E1";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color }}>
      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: dotBg, flexShrink: 0 }} />
      {label}
    </div>
  );
}

export default function Upload({ onUpload, loading }) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  function validateFile(file) {
    if (!file) return "No file selected";
    if (file.type !== "application/pdf") return "Only PDF files are supported";
    if (file.size > 10 * 1024 * 1024) return "File size must be under 10MB";
    return null;
  }

  function handleFile(file) {
    const err = validateFile(file);
    if (err) { setError(err); setSelectedFile(null); return; }
    setError(null);
    setSelectedFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  function handleSubmit() {
    if (selectedFile && !loading) onUpload(selectedFile);
  }

  return (
    <div style={S.page}>
      <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>

      <div style={S.nav}>
        <div style={S.navLeft}>
          <div style={S.navIcon}>
            <svg width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <span style={S.navName}>PO Extractor</span>
        </div>
        <div style={S.navPill}>⚡ Code-Based Extraction</div>
      </div>

      <div style={S.steps}>
        <Step num="1" label="Upload" state={loading ? "done" : "active"} />
        <span style={{ color: "#CBD5E1", fontSize: "11px", margin: "0 4px 0 0" }}>›</span>
        <Step num="2" label="Extract" state={loading ? "active" : "pending"} />
        <span style={{ color: "#CBD5E1", fontSize: "11px", margin: "0 4px 0 0" }}>›</span>
        <Step num="3" label="Review" state="pending" />
        <span style={{ color: "#CBD5E1", fontSize: "11px", margin: "0 4px 0 0" }}>›</span>
        <Step num="4" label="Export" state="pending" />
      </div>

      <div style={S.body}>
        {loading ? (
          <div style={S.loadingCard}>
            <div style={S.spinner} />
            <div style={S.loadTitle}>Processing your PO</div>
            <div style={S.loadSub}>{selectedFile?.name || "Your file"} — this usually takes 10–15 seconds</div>
            <div style={S.loadSteps}>
              <LoadingStep label="PDF received by backend" state="done" />
              <LoadingStep label="Extracting fields from document..." state="active" />
              <LoadingStep label="Applying CSV transformation rules" state="pending" />
              <LoadingStep label="Validating extracted fields" state="pending" />
            </div>
          </div>
        ) : (
          <div style={S.card}>
            <div style={S.cardTitle}>Upload a purchase order</div>
            <div style={S.cardSub}>Upload a PDF and the pipeline will extract, transform, and validate all PO fields automatically</div>

            <div
              style={dragOver ? S.dropzoneActive : S.dropzone}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <div style={S.dropIcon}>
                <svg width="22" height="22" fill="none" stroke="#1D6FE8" strokeWidth="2" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
              </div>
              <div style={S.dropTitle}>{dragOver ? "Drop it here!" : "Drop your PO PDF here"}</div>
              <div style={S.dropSub}>or click to browse files</div>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(e) => handleFile(e.target.files[0])} style={{ display: "none" }} />
            </div>

            {selectedFile && (
              <div style={S.fileSelected}>
                <svg width="18" height="18" fill="none" stroke="#1D4ED8" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span style={S.fileName}>{selectedFile.name}</span>
                <span style={S.fileSize}>{(selectedFile.size / 1024).toFixed(0)} KB</span>
                <svg onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} width="14" height="14" fill="none" stroke="#94A3B8" strokeWidth="2" viewBox="0 0 24 24" style={{ cursor: "pointer" }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
            )}

            {error && <div style={S.error}>{error}</div>}

            <button onClick={handleSubmit} disabled={!selectedFile} style={selectedFile ? S.btnPrimary : S.btnDisabled}>
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              Extract PO data
            </button>

            <div style={S.formats}>
              <span style={S.formatTag}>PDF only</span>
              <span style={S.formatTag}>Max 10MB</span>
              <span style={S.formatTag}>One PO per file</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}