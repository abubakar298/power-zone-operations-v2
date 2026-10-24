import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "./procurement.css";
import { readRfqReply } from "./rfq-reader.js";
import { fmtAt, fmtDay, qty, type RequestDetail } from "./types.js";

interface Rfq {
  id: string; number: string; dueOn: string; createdAt: string; createdBy: string; terms: string[]; items: { itemKey: string }[];
  vendors: { id: string; vendor: string; contact: string; repliedAt: string | null }[];
}
interface RfqList { rfqs: Rfq[]; defaults: { dueOn: string; terms: string[] }; vendorsUsed: string[]; can: { create: boolean } }

/**
 * Quotations from vendors on a purchase request (Moaz, 24 Oct 2026): send one tender-style RFQ to several vendors at
 * once, then enter each vendor's rates for every item in one go, typed or read from their filled Excel. The
 * comparative statement sets every vendor side by side for Abu Bakar.
 */
export function RfqPanel({ session, d, post }: { session: Session; d: RequestDetail; post: (path: string, body: unknown, message: string) => Promise<boolean> }) {
  const [data, setData] = useState<RfqList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const [vendors, setVendors] = useState([{ name: "", contact: "" }]);
  const [dueOn, setDueOn] = useState("");
  const [terms, setTerms] = useState("");
  const [vendor, setVendor] = useState("");
  const [rates, setRates] = useState<Record<string, { rate: string; note: string }>>({});
  const [read, setRead] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<RfqList>(`/procurement/requests/${d.id}/rfqs`);
      setData(r); setDueOn((x) => x || r.defaults.dueOn); setTerms((x) => x || r.defaults.terms.join("\n")); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Quotation requests could not be loaded."); }
  }, [d.id]);
  useEffect(() => { void load(); }, [load]);

  const asked = useMemo(() => [...new Map((data?.rfqs ?? []).flatMap((f) => f.vendors.map((v) => [v.vendor.toLowerCase(), v.vendor] as const))).values()], [data]);
  const quotedBy = (name: string) => d.lines.filter((l) => l.quotes.some((q) => q.vendor.trim().toLowerCase() === name.trim().toLowerCase())).length;
  const edit = d.can.edit;
  const anyQuotes = d.lines.some((l) => l.quotes.length > 0);

  const make = async () => {
    setBusy(true);
    try {
      const r = await api<RfqList & { rfq: Rfq }>(`/procurement/requests/${d.id}/rfqs`, {
        body: { vendors: vendors.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), contact: v.contact.trim() })), dueOn, terms: terms.split("\n").map((t) => t.trim()).filter(Boolean) },
        csrf: session.csrfToken,
      });
      setData(r); setMaking(false); setVendors([{ name: "", contact: "" }]);
      setNotice(`${r.rfq.number} made for ${r.rfq.vendors.length} vendor${r.rfq.vendors.length === 1 ? "" : "s"}. Download each vendor's PDF and Excel below, or all of them at once.`); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "The request for quotation was not made."); setNotice(""); }
    finally { setBusy(false); }
  };
  const pickVendor = (name: string) => {
    setVendor(name); setRead("");
    const next: Record<string, { rate: string; note: string }> = {};
    for (const l of d.lines) {
      const q = l.quotes.find((x) => x.vendor.trim().toLowerCase() === name.trim().toLowerCase());
      next[l.id] = { rate: q?.rate ?? "", note: q?.note ?? "" };
    }
    setRates(next);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const reply = readRfqReply(new Uint8Array(await file.arrayBuffer()));
      if (!vendor && reply.vendor) pickVendor(reply.vendor);
      const next = { ...rates };
      let matched = 0;
      for (const row of reply.rows) {
        const line = d.lines.find((l) => l.itemKey.toLowerCase() === row.itemKey.toLowerCase());
        if (line) { next[line.id] = { rate: row.rate, note: row.note }; matched++; }
      }
      setRates(next);
      const missed = reply.rows.length - matched;
      setRead(`${file.name}: ${matched} rate${matched === 1 ? "" : "s"} read${missed ? `, ${missed} item${missed === 1 ? "" : "s"} not on this request skipped` : ""}. Check them, then save.`);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "The file could not be read."); }
  };
  const save = async () => {
    const lines = d.lines.flatMap((l) => {
      const r = rates[l.id];
      return r && r.rate.trim() ? [{ lineId: l.id, rate: r.rate.trim().replace(/,/g, ""), note: r.note.trim() }] : [];
    });
    if (await post("/quotes/import", { vendor: vendor.trim(), lines }, `${vendor.trim()}: ${lines.length} rate${lines.length === 1 ? "" : "s"} saved. The lowest rate per item is chosen unless you picked another.`)) {
      setVendor(""); setRates({}); setRead(""); void load();
    }
  };

  return (
    <section className="ops-card">
      <div className="ops-tc-h"><h3>Quotations from vendors</h3><span className="pr-muted">one request for quotation to many vendors at once · no prices or customer names go to vendors</span></div>
      <div className="pr-additem">
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        {notice && !error && <p className="pr-notice" role="status">{notice}</p>}

        {data?.rfqs.map((f) => (
          <div key={f.id} className="sto-order">
            <div className="sto-order-head"><div>
              <b>{f.number} · due {fmtDay(f.dueOn)}</b>
              <small>{f.items.length} item{f.items.length === 1 ? "" : "s"} · made by {f.createdBy} {fmtAt(f.createdAt)} · <a href={`/api/procurement/rfqs/${f.id}/all.zip`} download>Download all vendors (zip)</a></small>
            </div></div>
            <table className="ops-table">
              <tbody>{f.vendors.map((v) => (
                <tr key={v.id}>
                  <td className="site"><b>{v.vendor}</b>{v.contact && <small>{v.contact}</small>}</td>
                  <td><a href={`/api/procurement/rfqs/${f.id}/vendors/${v.id}/pdf`} download>PDF</a> · <a href={`/api/procurement/rfqs/${f.id}/vendors/${v.id}/xlsx`} download>Excel</a></td>
                  <td>{v.repliedAt ? <span className="sw-chip sw-chip--ok">Quoted {quotedBy(v.vendor)} of {d.lines.length}</span> : <span className="sw-chip">Waiting</span>}</td>
                  <td>{edit && <button type="button" className="sw-link" onClick={() => pickVendor(v.vendor)}>Enter quotation</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ))}

        {data?.can.create && !making && <div className="pr-actions"><Button variant="secondary" onClick={() => setMaking(true)}>Request quotations from vendors</Button></div>}
        {data?.can.create && making && (
          <div className="pr-rfq-form">
            <b>New request for quotation</b>
            <datalist id={`rfq-vendors-${d.id}`}>{data.vendorsUsed.map((v) => <option key={v} value={v} />)}</datalist>
            {vendors.map((v, i) => (
              <div className="pr-addrow" key={i}>
                <input aria-label={`Vendor ${i + 1}`} list={`rfq-vendors-${d.id}`} placeholder="Vendor name" value={v.name} maxLength={200} onChange={(e) => setVendors(vendors.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} />
                <input aria-label={`Vendor ${i + 1} contact`} placeholder="Contact (optional): person, phone, email" value={v.contact} maxLength={300} onChange={(e) => setVendors(vendors.map((x, n) => (n === i ? { ...x, contact: e.target.value } : x)))} />
                {vendors.length > 1 && <button type="button" className="sw-link" onClick={() => setVendors(vendors.filter((_, n) => n !== i))}>Remove</button>}
              </div>
            ))}
            <div className="pr-actions"><button type="button" className="sw-link" onClick={() => setVendors([...vendors, { name: "", contact: "" }])}>+ Add another vendor</button></div>
            <label className="pr-muted">Quotations due by <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
            <label className="pr-muted">Terms (one per line)<textarea className="pr-note" rows={6} value={terms} maxLength={6000} onChange={(e) => setTerms(e.target.value)} /></label>
            <div className="pr-actions">
              <Button variant="primary" loading={busy} disabled={!vendors.some((v) => v.name.trim()) || !dueOn} onClick={() => void make()}>Make RFQs</Button>
              <Button variant="neutral" disabled={busy} onClick={() => setMaking(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {edit && (
          <div className="pr-rfq-form">
            <b>Enter a vendor's quotation for all items</b>
            <div className="pr-addrow">
              <input aria-label="Vendor for this quotation" list={`rfq-asked-${d.id}`} placeholder="Vendor" value={vendor} maxLength={200} onChange={(e) => setVendor(e.target.value)} onBlur={(e) => e.target.value.trim() && pickVendor(e.target.value.trim())} />
              <datalist id={`rfq-asked-${d.id}`}>{[...asked, ...(data?.vendorsUsed ?? [])].map((v) => <option key={v} value={v} />)}</datalist>
              <label className="sw-link pr-upload">Read the vendor's filled Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
            </div>
            {read && <p className="pr-muted" role="status">{read}</p>}
            {vendor.trim() && (
              <>
                <div className="pz-table-scroll">
                  <table className="ops-table">
                    <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate (PKR)</th><th>Brand, delivery, remarks</th></tr></thead>
                    <tbody>{d.lines.map((l) => {
                      const r = rates[l.id] ?? { rate: "", note: "" };
                      return (
                        <tr key={l.id}>
                          <td className="site"><b>{l.name}</b><small>{l.itemKey}</small></td>
                          <td className="num">{qty(l.quantity)} {l.unit}</td>
                          <td className="num"><input aria-label={`${l.name} rate`} inputMode="decimal" value={r.rate} onChange={(e) => setRates({ ...rates, [l.id]: { ...r, rate: e.target.value } })} /></td>
                          <td><input aria-label={`${l.name} note`} value={r.note} maxLength={500} onChange={(e) => setRates({ ...rates, [l.id]: { ...r, note: e.target.value } })} /></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
                <div className="pr-actions">
                  <Button variant="primary" loading={busy} disabled={!d.lines.some((l) => (rates[l.id]?.rate ?? "").trim())} onClick={() => void save()}>Save {vendor.trim()}'s quotation</Button>
                  <Button variant="neutral" onClick={() => { setVendor(""); setRates({}); setRead(""); }}>Cancel</Button>
                </div>
              </>
            )}
          </div>
        )}

        {anyQuotes && (
          <p className="pr-muted">Comparative statement, every vendor side by side: <a href={`/api/procurement/requests/${d.id}/comparison.pdf`} download>PDF</a> · <a href={`/api/procurement/requests/${d.id}/comparison.xlsx`} download>Excel</a></p>
        )}
      </div>
    </section>
  );
}
