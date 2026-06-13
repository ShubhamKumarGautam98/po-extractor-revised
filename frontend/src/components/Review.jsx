import { useState } from "react";

const C = {
  blue50: "#EFF6FF", blue100: "#BFDBFE", blue700: "#1D4ED8", blue600: "#1D6FE8",
  slate900: "#0F172A", slate700: "#334155", slate500: "#64748B", slate300: "#CBD5E1", slate200: "#E2E8F0", slate100: "#F1F5F9", slate50: "#F8FAFC",
  amber50: "#FFFBEB", amber200: "#FDE68A", amber600: "#D97706", amber800: "#92400E",
  green50: "#F0FDF4", green200: "#BBF7D0", green700: "#15803D", green800: "#166534",
  red50: "#FEF2F2", red200: "#FECACA", red700: "#B91C1C",
  white: "#FFFFFF",
};

function Nav() {
  return (
    <div style={{ background: C.white, borderBottom: `1px solid ${C.slate200}`, height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "30px", height: "30px", background: C.blue600, borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <span style={{ fontSize: "15px", fontWeight: "500", color: C.slate900 }}>PO Extractor</span>
      </div>
      <div style={{ fontSize: "11px", padding: "3px 10px", background: C.blue50, color: C.blue700, borderRadius: "20px", fontWeight: "500", border: `1px solid ${C.blue100}` }}>Code-Based Extraction</div>
    </div>
  );
}

function Steps() {
  return (
    <div style={{ background: C.white, borderBottom: `1px solid ${C.slate200}`, padding: "0 24px", display: "flex", alignItems: "center", flexShrink: 0 }}>
      {[
        { num: "OK", label: "Upload", done: true },
        { num: "OK", label: "Extract", done: true },
        { num: "3", label: "Review", active: true },
        { num: "4", label: "Export", pending: true },
      ].map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "12px 16px 12px 0", fontSize: "12px", color: s.done ? "#16A34A" : s.active ? C.blue600 : C.slate300, position: "relative", borderBottom: s.active ? `2px solid ${C.blue600}` : "2px solid transparent", marginBottom: "-1px" }}>
            <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `1.5px solid ${s.done ? "#16A34A" : s.active ? C.blue600 : C.slate300}`, background: s.done ? "#DCFCE7" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "500" }}>
              {s.num}
            </div>
            {s.label}
          </div>
          {i < 3 && <span style={{ color: C.slate300, fontSize: "11px", marginRight: "16px" }}>{">"}</span>}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    artifact_ready: { bg: C.green50, color: C.green800, border: C.green200, label: "Artifact ready" },
    needs_review: { bg: C.amber50, color: C.amber800, border: C.amber200, label: "Needs review" },
    failed: { bg: C.red50, color: C.red700, border: C.red200, label: "Failed" },
  };
  const s = cfg[status] || cfg.needs_review;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 12px", background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: "20px", fontSize: "11px", fontWeight: "500", whiteSpace: "nowrap" }}>
      {s.label}
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.slate200}`, borderRadius: "10px", marginBottom: "10px", overflow: "hidden" }}>
      <div style={{ padding: "9px 14px", background: C.blue50, borderBottom: `1px solid ${C.blue100}`, display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "11px", fontWeight: "500", color: C.blue700, textTransform: "uppercase", letterSpacing: ".06em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, missing }) {
  return (
    <div>
      <div style={{ fontSize: "10px", fontWeight: "500", color: C.slate500, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "4px" }}>{label}</div>
      <input
        type="text"
        value={value || ""}
        placeholder={missing ? "Missing - enter manually" : ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", border: `1px solid ${missing ? "#F59E0B" : C.blue100}`, borderRadius: "6px", fontSize: "12px", color: missing ? C.amber800 : C.slate900, background: missing ? C.amber50 : C.blue50, fontWeight: "500", outline: "none", boxSizing: "border-box" }}
      />
    </div>
  );
}

export default function Review({ data, onExport, onReset }) {
  const [po, setPO] = useState(data.purchase_order);
  const [issues, setIssues] = useState(data.issues || []);
  const [status, setStatus] = useState(data.status);

  const required = {
    header: ["action", "customer_code", "po_num", "div_code"],
    pr: ["currency", "incoterm_code", "incoterm_text", "season"],
    suppliers: ["vendor_code", "vendor_name", "vendor_currency", "vendor_inc_code", "vendor_incoterm"],
    items: ["style_no", "country_of_origin", "price", "factory_id", "color", "size_id"],
    shipments: ["port_of_loading", "port_of_discharge", "final_destination"],
  };

  function revalidate(updatedPO) {
    const newIssues = [];
    required.header.forEach(f => { if (!updatedPO.header?.[f]) newIssues.push({ section: "header", field: f, message: `header.${f} is missing` }); });
    required.pr.forEach(f => { if (!updatedPO.pr?.[f]) newIssues.push({ section: "pr", field: f, message: `pr.${f} is missing` }); });
    (updatedPO.suppliers || []).forEach((s, i) => required.suppliers.forEach(f => { if (!s[f]) newIssues.push({ section: "suppliers", field: f, message: `suppliers[${i}].${f} is missing` }); }));
    (updatedPO.items || []).forEach((s, i) => required.items.forEach(f => { if (!s[f]) newIssues.push({ section: "items", field: f, message: `items[${i}].${f} is missing` }); }));
    (updatedPO.shipments || []).forEach((s, i) => required.shipments.forEach(f => { if (!s[f]) newIssues.push({ section: "shipments", field: f, message: `shipments[${i}].${f} is missing` }); }));
    setIssues(newIssues);
    setStatus(newIssues.length === 0 ? "artifact_ready" : "needs_review");
  }

  function updateHeader(field, value) { const u = { ...po, header: { ...po.header, [field]: value } }; setPO(u); revalidate(u); }
  function updatePR(field, value) { const u = { ...po, pr: { ...po.pr, [field]: value } }; setPO(u); revalidate(u); }
  function updateSupplier(i, field, value) { const s = [...po.suppliers]; s[i] = { ...s[i], [field]: value }; const u = { ...po, suppliers: s }; setPO(u); revalidate(u); }
  function updateShipment(i, field, value) { const s = [...po.shipments]; s[i] = { ...s[i], [field]: value }; const u = { ...po, shipments: s }; setPO(u); revalidate(u); }
  function updateItem(i, field, value) { const items = [...po.items]; items[i] = { ...items[i], [field]: value }; const u = { ...po, items }; setPO(u); revalidate(u); }

  if (!po) return (
    <div style={{ minHeight: "100vh", background: C.slate50, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontSize: "14px", color: C.red700 }}>Failed to process this PO.</div>
      <button onClick={onReset} style={{ padding: "8px 20px", background: C.blue600, color: C.white, border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>Try Again</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.slate50, display: "flex", flexDirection: "column" }}>
      <Nav />
      <Steps />

      <div style={{ flex: 1, padding: "20px 24px", maxWidth: "900px", width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: "500", color: C.slate900 }}>Review extracted data</div>
            <div style={{ fontSize: "12px", color: C.slate500, marginTop: "3px" }}>{po.source_file} - edit any field before exporting</div>
          </div>
          <StatusBadge status={status} />
        </div>

        {issues.length > 0 && (
          <div style={{ display: "flex", gap: "10px", padding: "12px 14px", background: C.amber50, borderLeft: "3px solid #F59E0B", borderRadius: "0 8px 8px 0", marginBottom: "14px" }}>
            <span style={{ fontSize: "15px", flexShrink: 0, marginTop: "1px" }}>!</span>
            <div>
              <div style={{ fontSize: "12px", color: C.amber800, fontWeight: "500" }}>{issues.length} field{issues.length > 1 ? "s" : ""} need attention before exporting</div>
              <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "3px" }}>
                {issues.slice(0, 5).map((iss, i) => (
                  <div key={i} style={{ fontSize: "11px", color: C.amber800 }}>{"- "}{iss.message}</div>
                ))}
                {issues.length > 5 && <div style={{ fontSize: "11px", color: C.amber600 }}>+ {issues.length - 5} more</div>}
              </div>
            </div>
          </div>
        )}

        <SectionCard title="Header">
          <div style={{ padding: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: C.white }}>
            <Field label="Action" value={po.header?.action} onChange={v => updateHeader("action", v)} missing={!po.header?.action} />
            <Field label="Customer code" value={po.header?.customer_code} onChange={v => updateHeader("customer_code", v)} missing={!po.header?.customer_code} />
            <Field label="PO number" value={po.header?.po_num} onChange={v => updateHeader("po_num", v)} missing={!po.header?.po_num} />
            <Field label="Division code" value={po.header?.div_code} onChange={v => updateHeader("div_code", v)} missing={!po.header?.div_code} />
          </div>
        </SectionCard>

        <SectionCard title="PR - Purchase Request">
          <div style={{ padding: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: C.white }}>
            <Field label="Issue date" value={po.pr?.issue_date} onChange={v => updatePR("issue_date", v)} missing={!po.pr?.issue_date} />
            <Field label="Currency" value={po.pr?.currency} onChange={v => updatePR("currency", v)} missing={!po.pr?.currency} />
            <Field label="Incoterm code" value={po.pr?.incoterm_code} onChange={v => updatePR("incoterm_code", v)} missing={!po.pr?.incoterm_code} />
            <Field label="Incoterm text" value={po.pr?.incoterm_text} onChange={v => updatePR("incoterm_text", v)} missing={!po.pr?.incoterm_text} />
            <Field label="Season" value={po.pr?.season} onChange={v => updatePR("season", v)} missing={!po.pr?.season} />
          </div>
        </SectionCard>

        <SectionCard title="Suppliers">
          {(po.suppliers || []).map((sup, i) => (
            <div key={i}>
              {i > 0 && <div style={{ borderTop: `1px solid ${C.slate200}`, margin: "0 14px" }} />}
              <div style={{ padding: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: C.white }}>
                <Field label="Vendor code" value={sup.vendor_code} onChange={v => updateSupplier(i, "vendor_code", v)} missing={!sup.vendor_code} />
                <Field label="Vendor name" value={sup.vendor_name} onChange={v => updateSupplier(i, "vendor_name", v)} missing={!sup.vendor_name} />
                <Field label="Vendor currency" value={sup.vendor_currency} onChange={v => updateSupplier(i, "vendor_currency", v)} missing={!sup.vendor_currency} />
                <Field label="Incoterm code" value={sup.vendor_inc_code} onChange={v => updateSupplier(i, "vendor_inc_code", v)} missing={!sup.vendor_inc_code} />
                <Field label="Incoterm text" value={sup.vendor_incoterm} onChange={v => updateSupplier(i, "vendor_incoterm", v)} missing={!sup.vendor_incoterm} />
              </div>
            </div>
          ))}
        </SectionCard>

        <SectionCard title="Shipments">
          {(po.shipments || []).map((ship, i) => (
            <div key={i}>
              {i > 0 && <div style={{ borderTop: `1px solid ${C.slate200}`, margin: "0 14px" }} />}
              <div style={{ padding: "14px", background: C.white }}>
                <div style={{ fontSize: "11px", color: C.slate500, marginBottom: "10px", fontWeight: "500" }}>Shipment {ship.shipment_id}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <Field label="Port of loading" value={ship.port_of_loading} onChange={v => updateShipment(i, "port_of_loading", v)} missing={!ship.port_of_loading} />
                  <Field label="Port of discharge" value={ship.port_of_discharge} onChange={v => updateShipment(i, "port_of_discharge", v)} missing={!ship.port_of_discharge} />
                  <Field label="Final destination" value={ship.final_destination} onChange={v => updateShipment(i, "final_destination", v)} missing={!ship.final_destination} />
                </div>
              </div>
            </div>
          ))}
        </SectionCard>

        <SectionCard title={`Items - ${(po.items || []).length} lines`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: C.blue50 }}>
                  {["#", "Style no", "Color", "Size", "Price", "Country", "Factory"].map(h => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontSize: "10px", fontWeight: "500", color: C.blue700, textTransform: "uppercase", letterSpacing: ".05em", borderBottom: `1px solid ${C.blue100}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(po.items || []).map((item, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.slate50 }}>
                    <td style={{ padding: "5px 10px", color: C.slate500, borderBottom: `1px solid ${C.slate100}` }}>{item.item_id}</td>
                    {["style_no", "color", "size_id", "price", "country_of_origin", "factory_id"].map(field => (
                      <td key={field} style={{ padding: "4px 6px", borderBottom: `1px solid ${C.slate100}` }}>
                        <input
                          type="text"
                          value={item[field] || ""}
                          onChange={e => updateItem(i, field, e.target.value)}
                          style={{ width: "100%", padding: "3px 7px", border: `1px solid ${item[field] ? C.blue100 : "#F59E0B"}`, borderRadius: "4px", fontSize: "11px", color: item[field] ? C.slate900 : C.amber800, background: item[field] ? C.blue50 : C.amber50, minWidth: "70px", outline: "none" }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {po.prepacks && po.prepacks.length > 0 && (
          <SectionCard title={`Prepacks - ${po.prepacks.length} pack${po.prepacks.length > 1 ? "s" : ""}`}>
            <div style={{ padding: "14px", background: C.white }}>
              {po.prepacks.map((pack, i) => (
                <div key={i} style={{ marginBottom: i < po.prepacks.length - 1 ? "14px" : 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: "500", color: C.slate700, marginBottom: "8px" }}>Prepack {pack.prepack_id}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {(pack.details || []).map((d, j) => (
                      <div key={j} style={{ padding: "4px 10px", background: C.blue50, border: `1px solid ${C.blue100}`, borderRadius: "6px", fontSize: "11px", color: C.blue700, fontWeight: "500" }}>
                        {d.size_id} {d.pack_color && `/ ${d.pack_color}`}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", paddingTop: "16px", borderTop: `1px solid ${C.slate200}`, marginTop: "4px" }}>
          <button onClick={onReset} style={{ padding: "9px 18px", border: `1px solid ${C.slate300}`, borderRadius: "8px", fontSize: "13px", fontWeight: "500", color: C.slate700, background: C.white, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            Upload another
          </button>
          <button onClick={() => onExport({ status, purchase_order: po, issues })} style={{ padding: "9px 22px", background: C.blue600, color: C.white, border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            Export JSON
          </button>
        </div>

      </div>
    </div>
  );
}