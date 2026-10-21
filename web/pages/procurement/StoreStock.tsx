import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "../ops/ops.css";
import "./procurement.css";
import { fmtAt, fmtDay, qty } from "./types.js";

interface StoreItem { itemKey: string; name: string; unit: string; inRateMaster: boolean; inStock: string; counted: boolean; lastCountAt: string | null; stockUnit: string | null }
interface ToReceive {
  id: string; number: string; title: string; orderReference: string; orderedAt: string; orderedBy: string | null; deliveryTo: string; neededBy: string | null;
  lines: { itemKey: string; name: string; quantity: string; unit: string; vendor: string }[];
}
interface ItemHit { itemKey: string; name: string; unit: string }

/**
 * Store's page (Shaigan, 21 Oct 2026): receive what Procurement ordered, and keep the stock count.
 * Procurement reads these counts to work out what to buy. No purchase prices are shown here.
 */
export function StoreStock({ session }: { session: Session }) {
  const [data, setData] = useState<{ items: StoreItem[]; toReceive: ToReceive[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [extra, setExtra] = useState<StoreItem[]>([]);

  const load = useCallback(async () => {
    try { setData(await api<{ items: StoreItem[]; toReceive: ToReceive[] }>("/procurement/store")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load the stock page."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (search.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { void api<{ items: ItemHit[] }>(`/procurement/items?q=${encodeURIComponent(search.trim())}`).then((r) => setHits(r.items)).catch(() => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useMemo(() => {
    const all = [...(data?.items ?? []), ...extra.filter((x) => !(data?.items ?? []).some((i) => i.itemKey === x.itemKey))];
    const f = filter.trim().toLowerCase();
    return all.filter((i) => !f || i.name.toLowerCase().includes(f) || i.itemKey.toLowerCase().includes(f));
  }, [data, extra, filter]);

  const saveCount = async (i: StoreItem) => {
    setBusy(true);
    try {
      await api("/procurement/stock/counts", { body: { itemKey: i.itemKey, quantity: counts[i.itemKey].trim().replace(/,/g, ""), unit: i.unit }, csrf: session.csrfToken });
      const next = { ...counts }; delete next[i.itemKey]; setCounts(next);
      setNotice(`${i.name}: count saved.`); setError(""); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "The count was not saved."); setNotice(""); }
    finally { setBusy(false); }
  };
  const receive = async (r: ToReceive) => {
    setBusy(true);
    try {
      await api(`/procurement/requests/${r.id}/received`, { body: { note: notes[r.id] ?? "" }, csrf: session.csrfToken });
      setNotice(`${r.number} received into Store; the quantities were added to stock.`); setError(""); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "The receipt was not saved."); setNotice(""); }
    finally { setBusy(false); }
  };

  return (
    <div className="ops ops-embed">
      <div className="pr">
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        {notice && !error && <p className="pr-notice" role="status">{notice}</p>}

        <section className="ops-card">
          <div className="ops-tc-h"><h3>Material to receive</h3><span className="pr-muted">ordered by Procurement · mark it received when it reaches the store</span></div>
          {!data ? <p className="ops-empty">Loading…</p> : data.toReceive.length === 0 ? <p className="ops-empty">Nothing is on order right now.</p> : (
            <div className="sto-receive">
              {data.toReceive.map((r) => (
                <div key={r.id} className="sto-order">
                  <div className="sto-order-head">
                    <div><b>{r.number} · {r.title}</b><small>Ordered {fmtAt(r.orderedAt)}{r.orderedBy ? ` by ${r.orderedBy}` : ""} · {r.orderReference}{r.neededBy ? ` · needed by ${fmtDay(r.neededBy)}` : ""}</small></div>
                  </div>
                  <table className="ops-table">
                    <thead><tr><th>Item</th><th className="num">Quantity</th><th>Vendor</th></tr></thead>
                    <tbody>{r.lines.map((l) => <tr key={l.itemKey}><td className="site"><b>{l.name}</b></td><td className="num">{qty(l.quantity)} {l.unit}</td><td>{l.vendor || "—"}</td></tr>)}</tbody>
                  </table>
                  <div className="sto-order-foot">
                    <input aria-label={`${r.number} note`} placeholder="Note (optional): anything missing or damaged" value={notes[r.id] ?? ""} maxLength={1000} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <Button variant="primary" loading={busy} onClick={() => void receive(r)}>Received into Store</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="ops-card">
          <div className="ops-tc-h"><h3>Stock count</h3><span className="pr-muted">enter what is physically in the store; receipts after your count are added automatically</span></div>
          <div className="ops-tools">
            <input className="sto-filter" aria-label="Filter items" placeholder="Filter items: cable, MCB, breaker…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span className="count">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
          </div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>Item</th><th className="num">In stock now</th><th>Last counted</th><th className="num">New count</th></tr></thead>
              <tbody>
                {!data ? <tr><td colSpan={4} className="ops-empty">Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={4} className="ops-empty">No items match.</td></tr> : rows.map((i) => (
                  <tr key={i.itemKey}>
                    <td className="site"><b>{i.name}</b><small>{i.unit}{!i.inRateMaster ? " · not in the rate master, cannot be counted here" : ""}</small></td>
                    <td className="num">{qty(i.inStock)} {i.unit}</td>
                    <td className="date">{i.lastCountAt ? fmtAt(i.lastCountAt) : "never"}</td>
                    <td className="num">
                      {i.inRateMaster ? (
                        <span className="sto-count">
                          <input aria-label={`${i.name} new count`} inputMode="decimal" placeholder={i.unit} value={counts[i.itemKey] ?? ""} onChange={(e) => setCounts({ ...counts, [i.itemKey]: e.target.value })} />
                          <Button variant="secondary" loading={busy} disabled={!(counts[i.itemKey] ?? "").trim()} onClick={() => void saveCount(i)}>Save</Button>
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pr-additem">
            <label className="pr-muted" htmlFor="sto-search">Count an item that is not listed</label>
            <input id="sto-search" className="sto-filter" placeholder="Search the rate master: type at least two letters" value={search} onChange={(e) => setSearch(e.target.value)} />
            {hits.length > 0 && (
              <div className="pr-hits">
                {hits.map((h) => (
                  <button type="button" key={h.itemKey} onClick={() => { setExtra([...extra, { itemKey: h.itemKey, name: h.name, unit: h.unit, inRateMaster: true, inStock: "0", counted: false, lastCountAt: null, stockUnit: null }]); setFilter(h.name); setSearch(""); }}>
                    <b>{h.name}</b><small>{h.unit}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
