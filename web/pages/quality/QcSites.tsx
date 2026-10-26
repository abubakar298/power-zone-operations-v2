import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "../ops/ops.css";
import "../procurement/procurement.css";
import { fmtAt, fmtDay } from "../procurement/types.js";
import { kb, prepareUpload } from "./shrink.js";

type Kind = "solar_dc" | "bess_dc" | "installation" | "cable_variance" | "acknowledgement";
interface Qc { items: { kind: Kind; label: string; done: boolean; dueAt: string | null; overdue: boolean }[]; red: boolean; required: number; done: number; missing: string[]; overdue: string[] }
interface SiteRow {
  id: string; site: string; customer: string | null; region: string | null; ipoNumber: string; siteType: string | null; scope: string | null; stage: string;
  deliveredOn: string | null; bessDeliveredOn: string | null; closed: boolean; qc: Qc; nextDue: { label: string; dueAt: string; overdue: boolean } | null; drafts: number;
}
interface FileRow { id: string; kind: Kind; submissionId: string | null; filename: string; mime: string; size: number; originalSize: number; uploadedAt: string; by: string }
interface Detail {
  id: string; site: string; customer: string | null; region: string | null; ipoNumber: string; siteType: string | null; scope: string | null; stage: string; closed: boolean;
  deliveredOn: string | null; bessDeliveredOn: string | null; qc: Qc;
  documents: (Qc["items"][number] & { submissions: { id: string; at: string; by: string; note: string; onTime: boolean | null; dueAt: string | null; files: FileRow[] }[]; drafts: FileRow[] })[];
  can: { upload: boolean };
}
const TABS = [
  { key: "open", label: "Needs documents", f: (s: SiteRow) => s.qc.done < s.qc.required && !s.closed },
  { key: "red", label: "Red", f: (s: SiteRow) => s.qc.red },
  { key: "done", label: "Complete", f: (s: SiteRow) => s.qc.done >= s.qc.required },
  { key: "all", label: "All", f: () => true },
] as const;

/**
 * Site documents from Quality Control (Moaz, 26 Oct 2026). Quality Control attaches and submits ("upload"); Shaigan,
 * the named Accounts people, Admin and Management only look ("view"). Red: a delivery whose papers are not in by the
 * end of the next working day.
 */
export function QcSites({ session, mode, openId }: { session: Session; mode: "upload" | "view"; openId?: string }) {
  const [data, setData] = useState<{ sites: SiteRow[] } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(mode === "upload" ? "open" : "all");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | undefined>(openId);
  const load = useCallback(async () => {
    try { setData(await api<{ sites: SiteRow[] }>("/qc/sites")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Site documents could not be loaded."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 120_000); return () => clearInterval(t); }, [load]);
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data?.sites ?? []).filter(TABS.find((t) => t.key === tab)!.f)
      .filter((s) => !f || [s.site, s.customer ?? "", s.ipoNumber, s.region ?? ""].some((x) => x.toLowerCase().includes(f)));
  }, [data, tab, filter]);

  if (open) return <SiteDocs session={session} id={open} mode={mode} onBack={() => { setOpen(undefined); void load(); }} />;
  return (
    <div className="pr">
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      <section className="ops-card">
        <div className="ops-tc-h"><h3>Site documents</h3><span className="pr-muted">DCs, delivery and installation pictures, reports and acknowledgement · red: delivery papers not in by the end of the next working day</span></div>
        <div className="ops-tools">
          <div className="ops-tabs">{TABS.map((t) => <button type="button" key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label} <span className="n">{(data?.sites ?? []).filter(t.f).length}</span></button>)}</div>
          <input className="sto-filter" aria-label="Filter sites" placeholder="Filter: site, customer, IPO, region…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>Site</th><th>Type</th><th>Delivered</th><th className="num">Documents</th><th>Next deadline</th><th>Status</th></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={6} className="ops-empty">Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={6} className="ops-empty">No sites here.</td></tr> : rows.map((s) => (
                <tr key={s.id} data-clickable className={s.qc.red ? "qc-red" : undefined} onClick={() => setOpen(s.id)}>
                  <td className="site"><b>{s.site}</b><small>{s.customer ?? "—"} · IPO {s.ipoNumber}{s.region ? ` · ${s.region}` : ""}</small></td>
                  <td>{s.siteType ?? "—"}{s.scope === "delivery_only" ? <small className="pr-muted"> · delivery only</small> : null}</td>
                  <td className="date">{s.deliveredOn ? fmtDay(s.deliveredOn) : "not yet"}{s.bessDeliveredOn ? <><br /><small>BESS {fmtDay(s.bessDeliveredOn)}</small></> : null}</td>
                  <td className="num">{s.qc.done}/{s.qc.required}{mode === "upload" && s.drafts > 0 ? <small className="pr-muted"> · {s.drafts} attached</small> : null}</td>
                  <td className="date">{s.nextDue ? <>{s.nextDue.label}<br /><small>{s.nextDue.overdue ? "was due " : "due "}{fmtAt(s.nextDue.dueAt)}</small></> : "—"}</td>
                  <td>{s.qc.red ? <span className="sw-chip sw-chip--danger">No delivery papers</span>
                    : s.qc.overdue.length ? <span className="sw-chip sw-chip--danger">Overdue</span>
                    : s.qc.done >= s.qc.required ? <span className="sw-chip sw-chip--ok">Complete</span>
                    : <span className="sw-chip">In progress</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SiteDocs({ session, id, mode, onBack }: { session: Session; id: string; mode: "upload" | "view"; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try { setD(await api<Detail>(`/qc/sites/${id}`)); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The site could not be loaded."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const canUpload = mode === "upload" && Boolean(d?.can.upload);

  const attach = async (kind: Kind, files: FileList | null) => {
    if (!files?.length) return;
    let saved = 0, before = 0, after = 0;
    try {
      for (const [n, file] of [...files].entries()) {
        setBusy(`Shrinking and attaching ${n + 1} of ${files.length}…`);
        const p = await prepareUpload(file);
        setD(await api<Detail>(`/qc/sites/${id}/files`, { body: { kind, filename: p.filename, mime: p.mime, base64: p.base64, originalSize: p.originalSize }, csrf: session.csrfToken }));
        saved++; before += p.originalSize; after += p.size;
      }
      setNotice(`${saved} file${saved === 1 ? "" : "s"} attached (${kb(before)} shrunk to ${kb(after)}). Press Submit when everything for this document is here.`); setError("");
    } catch (e) { setError(`${saved ? `${saved} attached. ` : ""}${e instanceof Error ? e.message : "The file was not attached."}`); setNotice(""); }
    finally { setBusy(""); }
  };
  const call = async (path: string, body: object, done: string) => {
    setBusy("Saving…");
    try { setD(await api<Detail>(path, { body, csrf: session.csrfToken })); setNotice(done); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Not saved."); setNotice(""); }
    finally { setBusy(""); }
  };
  const fileLink = (f: FileRow) => (
    <a key={f.id} className="qc-file" href={`/api/qc/files/${f.id}`} target="_blank" rel="noopener noreferrer" title={f.filename}>
      {f.mime.startsWith("image/") ? <img src={`/api/qc/files/${f.id}`} alt={f.filename} loading="lazy" /> : <span className="qc-pdf">PDF</span>}
      <span>{f.filename.length > 22 ? `${f.filename.slice(0, 20)}…` : f.filename} · {kb(f.size)}</span>
    </a>
  );

  return (
    <div className="pr">
      <div><Button variant="neutral" onClick={onBack}>Back to sites</Button></div>
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      {notice && !error && <p className="pr-notice" role="status">{notice}</p>}
      {!d ? <p className="pr-muted">Loading…</p> : (
        <>
          <section className={`ops-card${d.qc.red ? " qc-doc--red" : ""}`}>
            <div className="ops-tc-h"><h3>{d.site}</h3><span className="pr-muted">{d.customer ?? "—"} · IPO {d.ipoNumber} · {d.siteType ?? "type not set"}{d.scope === "delivery_only" ? " · delivery only" : ""}</span></div>
            <div className="pr-additem">
              <div className="ops-kv">
                <div><span>Delivered</span><b>{d.deliveredOn ? fmtDay(d.deliveredOn) : "not yet"}</b></div>
                {d.bessDeliveredOn && <div><span>BESS delivered</span><b>{fmtDay(d.bessDeliveredOn)}</b></div>}
                <div><span>Documents</span><b>{d.qc.done} of {d.qc.required} submitted</b></div>
                <div><span>Site</span><b>{d.closed ? "Closed" : "Open"}</b></div>
              </div>
              {d.qc.red && <p className="ops-feedback">No delivery papers yet, and the next working day after delivery has ended.</p>}
              {busy && <p className="pr-muted" role="status">{busy}</p>}
            </div>
          </section>
          {d.documents.map((doc) => {
            const latest = doc.submissions[0];
            return (
              <section key={doc.kind} className={`qc-doc${doc.overdue ? " qc-doc--red" : ""}`}>
                <div className="qc-doc-head">
                  <b>{doc.label}</b>
                  <span>
                    {doc.done ? <span className={`sw-chip ${latest?.onTime === false ? "sw-chip--warning" : "sw-chip--ok"}`}>Submitted {fmtAt(latest!.at)}{latest?.onTime === false ? " · late" : latest?.onTime ? " · on time" : ""}</span>
                      : doc.overdue ? <span className="sw-chip sw-chip--danger">Overdue · was due {fmtAt(doc.dueAt!)}</span>
                      : doc.dueAt ? <span className="sw-chip">Due {fmtAt(doc.dueAt)}</span> : <span className="sw-chip">Needed before the site closes</span>}
                  </span>
                </div>
                {doc.submissions.map((s) => (
                  <div key={s.id} className="pr-muted">
                    <div>{fmtAt(s.at)} · {s.by}{s.onTime === false ? " · late" : ""}{s.note ? ` · ${s.note}` : ""}</div>
                    <div className="qc-files">{s.files.map(fileLink)}</div>
                  </div>
                ))}
                {canUpload && (
                  <>
                    {doc.drafts.length > 0 && (
                      <div>
                        <span className="pr-muted">Attached, not submitted yet:</span>
                        <div className="qc-files">{doc.drafts.map((f) => (
                          <span key={f.id} style={{ display: "grid", gap: 4 }}>{fileLink(f)}
                            <button type="button" className="sw-link" disabled={Boolean(busy)} onClick={() => void call(`/qc/files/${f.id}/remove`, {}, `${f.filename} removed.`)}>Remove</button>
                          </span>
                        ))}</div>
                      </div>
                    )}
                    <div className="qc-upload">
                      <label className="sw-link pr-upload">+ Attach pictures or PDFs
                        <input type="file" multiple accept="image/*,application/pdf" disabled={Boolean(busy)} onChange={(e) => { void attach(doc.kind, e.target.files); e.target.value = ""; }} />
                      </label>
                      <input aria-label={`${doc.label} note`} placeholder="Note (optional)" maxLength={1000} value={notes[doc.kind] ?? ""} onChange={(e) => setNotes({ ...notes, [doc.kind]: e.target.value })} />
                      <Button variant="primary" loading={busy === "Saving…"} disabled={!doc.drafts.length || Boolean(busy)}
                        onClick={() => void call(`/qc/sites/${id}/submit`, { kind: doc.kind, note: notes[doc.kind] ?? "" }, `${doc.label} submitted. Store and Accounts have been told.`)}>Submit</Button>
                    </div>
                  </>
                )}
                {!doc.done && !canUpload && <span className="pr-muted">Not submitted yet.</span>}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
