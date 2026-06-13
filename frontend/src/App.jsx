import { useState } from "react";
import Upload from "./components/Upload";
import Review from "./components/Review";
import { extractPO, downloadJSON } from "./api";

const SCREENS = { UPLOAD: "upload", LOADING: "loading", REVIEW: "review", ERROR: "error" };

export default function App() {
  const [screen, setScreen] = useState(SCREENS.UPLOAD);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  async function handleUpload(file) {
    setScreen(SCREENS.LOADING);
    setErrorMsg(null);
    const data = await extractPO(file);
    if (data.status === "failed" && !data.purchase_order) {
      setErrorMsg(data.issues?.[0]?.message || "Something went wrong. Please try again.");
      setScreen(SCREENS.ERROR);
      return;
    }
    setResult(data);
    setScreen(SCREENS.REVIEW);
  }

  function handleExport(finalData) {
    const poNum = finalData.purchase_order?.header?.po_num || "export";
    downloadJSON(finalData, `PO_${poNum}.json`);
  }

  function handleReset() {
    setScreen(SCREENS.UPLOAD);
    setResult(null);
    setErrorMsg(null);
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        body { background: #F8FAFC; }
        input:focus { outline: 2px solid #1D6FE8; outline-offset: 1px; }
        button:hover { opacity: 0.9; }
        button:active { transform: scale(0.98); }
      `}</style>

      {(screen === SCREENS.UPLOAD || screen === SCREENS.LOADING) && (
        <Upload onUpload={handleUpload} loading={screen === SCREENS.LOADING} />
      )}

      {screen === SCREENS.REVIEW && result && (
        <Review data={result} onExport={handleExport} onReset={handleReset} />
      )}

      {screen === SCREENS.ERROR && (
        <div style={{ minHeight: "100vh", background: "#F8FAFC", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "40px 32px", maxWidth: "420px", width: "100%", textAlign: "center" }}>
            <div style={{ width: "48px", height: "48px", background: "#FEF2F2", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: "22px" }}>⚠️</div>
            <div style={{ fontSize: "17px", fontWeight: "500", color: "#0F172A", marginBottom: "8px" }}>Processing failed</div>
            <div style={{ fontSize: "13px", color: "#64748B", marginBottom: "24px" }}>{errorMsg}</div>
            <button onClick={handleReset} style={{ padding: "9px 24px", background: "#1D6FE8", color: "#FFFFFF", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </div>
      )}
    </>
  );
}