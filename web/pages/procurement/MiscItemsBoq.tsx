import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { StatusBadge } from "../../ui/StatusBadge.js";
import "./procurement.css";
import { fmtAt, qty } from "./types.js";

export interface MiscCatItem { itemKey: string; name: string; unit: string; active: boolean }
export interface MiscCatalogue { items: MiscCatItem[]; options: { key: string; label: string; items: { itemKey: string; quantity: string }[] }[]; can: { addItem: boolean; editItems: boolean } }
interface SiteMisc {
  recordId: string; siteName: string; siteCode: string; customer: string | null; stage: string;
  boq: null | {
    optionKey: string | null; optionLabel: string | null; version: number; note: string; updatedBy: string; updatedAt: string;
    sentBy: string | null; sentAt: string | null; sentNote: string; lines: { itemKey: string; name: string; unit: string; quantity: string }[];
  };
  suggestion: null | { optionKey: string; exact: boolean; survey: string };
  events: { kind: string; version: number; note: string; actor: string; at: string }[];
  can: { edit: boolean; send: boolean };
}
type Line = { itemKey: string; quantity: string };

/**
 * Misc items BOQ on a site's survey step (Moaz, 24 Oct 2026). Design picks one of the four system sizes and adjusts it
 * on the spot. It is folded away, and the server shows it only to Design, Procurement, Store, Admin and Management:
 * it never reaches BOQs, quotations or customer documents.
 */
export function MiscItemsBoq({ session, recordId }: { session: Session; recordId: string }) {
  const [site, setSite] = useState<SiteMisc | null>(null);
  const [cat, setCat] = useState<MiscCatalogue | null>(null);
  const [hidden, setHidden] = useState(false);
  const [option, setOption] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [newUnit, setNewUnit] = useState("Nos");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<SiteMisc>(`/procurement/misc/sites/${recordId}`), api<MiscCatalogue>("/procurement/misc/catalogue")]);
      setSite(s); setCat(c);
      setOption(s.boq?.optionKey ?? s.suggestion?.optionKey ?? "");
      setLines(s.boq?.lines.map((l) => ({ itemKey: l.itemKey, quantity: l.quantity })) ?? []);
      setNote(s.boq?.note ?? "");
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setHidden(true);
      else setError(e instanceof Error ? e.message : "The misc items BOQ could not be loaded.");
    }
  }, [recordId]);
  useEffect(() => { void load(); }, [load]);

  const byKey = useMemo(() => new Map((cat?.items ?? []).map((i) => [i.itemKey, i])), [cat]);
  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2 || !cat) return [];
    return cat.items.filter((i) => i.active && !lines.some((l) => l.itemKey === i.itemKey) && (i.name.toLowerCase().includes(q) || i.itemKey.toLowerCase().includes(q))).slice(0, 8);
  }, [search, cat, lines]);
  const exactName = cat?.items.some((i) => i.name.trim().toLowerCase() === search.trim().toLowerCase()) ?? false;

  if (hidden) return null;
  const edit = Boolean(site?.can.edit);
  const change = (next: Line[]) => { setLines(next); setDirty(true); setNotice(""); };
  const fillFrom = (key: string) => {
    const o = cat?.options.find((x) => x.key === key);
    if (!o) return;
    change(o.items.map((i) => ({ ...i })));
    setNotice(`Filled with the ${o.label} quantities. Adjust them for this site, then save.`);
  };
  const addNew = async () => {
    setBusy(true); setError("");
    try {
      const item = await api<MiscCatItem>("/procurement/misc/items", { body: { name: search.trim(), unit: newUnit.trim() }, csrf: session.csrfToken });
      setCat((c) => (c ? { ...c, items: [...c.items, item] } : c));
      change([...lines, { itemKey: item.itemKey, quantity: "" }]);
      setSearch(""); setNotice(`${item.name} added to the misc items list as ${item.itemKey}. Enter its quantity.`);
    } catch (e) { setError(e instanceof Error ? e.message : "The item was not added."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    const missing = lines.find((l) => !(Number(l.quantity.trim().replace(/,/g, "")) > 0));
    if (missing) { setError(`Enter a quantity for ${byKey.get(missing.itemKey)?.name ?? missing.itemKey}, or remove it.`); return; }
    setBusy(true); setError("");
    try {
      const s = await api<SiteMisc>(`/procurement/misc/sites/${recordId}/save`, {
        body: { version: site?.boq?.version ?? null, optionKey: option || null, lines: lines.map((l) => ({ itemKey: l.itemKey, quantity: l.quantity.trim().replace(/,/g, "") })), note },
        csrf: session.csrfToken,
      });
      setSite(s); setDirty(false); setNotice("Misc items saved. Procurement and Store can see them now.");
    } catch (e) { setError(e instanceof Error ? e.message : "The misc items were not saved."); }
    finally { setBusy(false); }
  };

  const b = site?.boq;
  const badge = !site ? null : b?.sentAt ? <StatusBadge tone="success">Sent to site</StatusBadge>
    : b ? <StatusBadge tone="pending">{b.lines.length} item{b.lines.length === 1 ? "" : "s"}{b.optionLabel ? ` · ${b.optionKey}` : ""}</StatusBadge>
    : <StatusBadge tone="warning">Not filled yet</StatusBadge>;

  return (
    <details className="pz-panel pz-stack pz-misc">
      <summary><b>Misc items BOQ</b> <span className="pz-caption">for Procurement and Store only</span> {badge}</summary>
      {!site || !cat ? <p className="pz-caption">{error || "Loading…"}</p> : (
        <>
          <p className="pz-caption">
            Screws, thimbles, pipes, clamps and other small items for this site. Hamza buys them and Shaigan sends them to site.
            They never appear on the BOQ, the quotation or customer documents.
          </p>
          {edit && (
            <div className="pz-form-grid">
              <Field id={`misc-option-${recordId}`} label="System size" hint={site.suggestion ? `Survey: ${site.suggestion.survey}${site.suggestion.exact ? "" : " · nearest option"}` : "Pick the option closest to this site."}>
                <select id={`misc-option-${recordId}`} value={option} onChange={(e) => { setOption(e.target.value); setDirty(true); if (e.target.value && lines.length === 0) fillFrom(e.target.value); }}>
                  <option value="">Choose…</option>
                  {cat.options.map((o) => <option key={o.key} value={o.key}>{o.label}{site.suggestion?.optionKey === o.key ? " (suggested)" : ""}</option>)}
                </select>
              </Field>
              <div className="pz-action-row">
                <Button variant="secondary" disabled={!option || busy} onClick={() => fillFrom(option)}>{lines.length ? "Replace with this option's quantities" : "Fill from this option"}</Button>
              </div>
            </div>
          )}
          {b?.sentAt && <p className="pz-caption">Sent to site by {b.sentBy} {fmtAt(b.sentAt)}{b.sentNote ? ` · ${b.sentNote}` : ""}. The list can no longer change.</p>}
          {lines.length === 0 ? <p className="pz-caption">{edit ? "No misc items yet. Pick a system size above, or add items below." : "Design has not filled the misc items for this site yet."}</p> : (
            <div className="pz-table-scroll">
              <table className="pz-table">
                <thead><tr><th>Item</th><th>Unit</th><th className="pz-misc-num">Quantity</th>{edit && <th></th>}</tr></thead>
                <tbody>
                  {lines.map((l, n) => {
                    const item = byKey.get(l.itemKey);
                    return (
                      <tr key={l.itemKey}>
                        <td>{item?.name ?? l.itemKey} <small className="pz-caption">{l.itemKey}</small></td>
                        <td>{item?.unit ?? ""}</td>
                        <td className="pz-misc-num">
                          {edit ? <input className="pz-misc-qty" aria-label={`${item?.name ?? l.itemKey} quantity`} inputMode="decimal" value={l.quantity}
                            onChange={(e) => change(lines.map((x, i) => (i === n ? { ...x, quantity: e.target.value } : x)))} /> : qty(l.quantity)}
                        </td>
                        {edit && <td><button type="button" className="pz-misc-remove" aria-label={`Remove ${item?.name ?? l.itemKey}`} onClick={() => change(lines.filter((_, i) => i !== n))}>Remove</button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {edit && (
            <>
              <Field id={`misc-add-${recordId}`} label="Add an item" hint="Search the misc items list; if it is not there, add it as a new item.">
                <input id={`misc-add-${recordId}`} value={search} placeholder="Type at least two letters: screw, pipe, clamp…" onChange={(e) => setSearch(e.target.value)} />
              </Field>
              {hits.length > 0 && (
                <div className="pz-misc-hits">
                  {hits.map((h) => <button type="button" key={h.itemKey} onClick={() => { change([...lines, { itemKey: h.itemKey, quantity: "" }]); setSearch(""); }}>{h.name} <small>{h.unit}</small></button>)}
                </div>
              )}
              {cat.can.addItem && search.trim().length >= 2 && !exactName && (
                <div className="pz-action-row">
                  <span className="pz-caption">Not on the list?</span>
                  <input className="pz-misc-unit" aria-label="Unit of the new item" value={newUnit} maxLength={30} onChange={(e) => setNewUnit(e.target.value)} />
                  <Button variant="secondary" loading={busy} disabled={!newUnit.trim()} onClick={() => void addNew()}>Add “{search.trim()}” as a new item</Button>
                </div>
              )}
              <Field id={`misc-note-${recordId}`} label="Note for Procurement and Store (optional)">
                <textarea id={`misc-note-${recordId}`} value={note} maxLength={1000} onChange={(e) => { setNote(e.target.value); setDirty(true); }} />
              </Field>
              <div className="pz-action-row">
                <Button variant="primary" loading={busy} disabled={!dirty || lines.length === 0} onClick={() => void save()}>Save misc items</Button>
                {dirty && <Button variant="neutral" disabled={busy} onClick={() => void load()}>Discard changes</Button>}
              </div>
            </>
          )}
          {!edit && b?.note && <p className="pz-caption">Note: {b.note}</p>}
          {error && <p role="alert" className="pz-misc-error">{error}</p>}
          {notice && !error && <p role="status" className="pz-caption">{notice}</p>}
          {site.events.length > 0 && (
            <details>
              <summary className="pz-caption">History</summary>
              <ul className="pz-misc-history">
                {site.events.map((e, i) => <li key={i}>{e.kind === "sent" ? "Sent to site" : `Saved (version ${e.version})`} · {e.actor} · {fmtAt(e.at)}{e.note ? ` · ${e.note}` : ""}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </details>
  );
}
