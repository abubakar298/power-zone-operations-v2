import { useRef, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { FileUpload } from "../ui/FileUpload.js";
import { StatusBadge } from "../ui/StatusBadge.js";
import { confirmTransition } from "../confirm.js";
import { money } from "../numbers.js";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";

/** Customer PO received later (user request, 24 Nov 2026): a site confirmed on email/WhatsApp approval gets its formal PO here. */
const latePoFileKind = "Customer PO (received later)";
const day = (value?: string | null) => (value ? String(value).slice(0, 10) : "Not entered");

type FollowUp = { poToFollow?: boolean; latePo?: any; approvalEvidenceType?: string | null };

/** Secondary status line shown under a site's PO reference; nothing for sites that need no PO follow-up. */
export function CustomerPoStatus({ followUp, recordId, showNumber = true }: { followUp?: FollowUp | null; recordId?: string; showNumber?: boolean }) {
  const latePo = followUp?.latePo;
  if (latePo)
    return <div className="pz-caption">
      <StatusBadge tone={latePo.amountDiffers ? "warning" : "success"}>{latePo.amountDiffers ? "PO differs from IPO" : "PO received later"}</StatusBadge>
      {showNumber && <div>PO {latePo.poNumber} · {day(latePo.poDate)}{recordId && latePo.fileId && <> · <a href={`/api/project-workflow/${recordId}/files/${latePo.fileId}`} target="_blank" rel="noreferrer">Open PO</a></>}</div>}
    </div>;
  if (!followUp?.poToFollow) return null;
  return <div className="pz-caption">
    <StatusBadge tone="pending">Customer PO pending</StatusBadge>
    {followUp.approvalEvidenceType && <div>Approved by {followUp.approvalEvidenceType}</div>}
  </div>;
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function LatePoDetails({ recordId, latePo }: { recordId: string; latePo: any }) {
  return <div className="pz-stack">
    <p><strong>PO {latePo.poNumber}</strong> · PO date {day(latePo.poDate)}{latePo.version > 1 ? ` · version ${latePo.version}` : ""}</p>
    <p className="pz-caption">
      PO amount {latePo.poAmount ? `PKR ${money(latePo.poAmount)}` : "not entered"}
      {latePo.ipoAmount ? ` · IPO ${latePo.ipoNumber ?? ""} PKR ${money(latePo.ipoAmount)}` : ""}
    </p>
    {latePo.amountDiffers && <p className="form-error" role="alert">The PO amount differs from the issued IPO. The IPO is not changed; Management decides whether an IPO revision is needed.</p>}
    <p className="pz-caption">Attached by {latePo.byName ?? "Coordination"} · {latePo.at ? new Date(latePo.at).toLocaleString("en-GB", { timeZone: "Asia/Karachi" }) + " PKT" : ""}</p>
    {latePo.notes && <p className="pz-caption">Note: {latePo.notes}</p>}
    <p><a href={`/api/project-workflow/${recordId}/files/${latePo.fileId}`} target="_blank" rel="noreferrer">Open {latePo.filename ?? "customer PO"}</a></p>
  </div>;
}

/** IPOs Shared → Preview: the customer PO status and, for the site's coordinator, "Attach customer PO". */
export function LateCustomerPoPanel({ session, record }: { session?: Session; record: any }) {
  const approval = ["WhatsApp approval", "Email approval"].includes(record.data?.approvalEvidenceType);
  // Owner-approved exceptions (shared/late-customer-po-exceptions.ts) come from the server as latePoAllowed.
  const allowed = approval || record.data?.latePoAllowed === true;
  const [latePo, setLatePo] = useState<any>(record.data?.latePo ?? null);
  const [versions, setVersions] = useState<any[]>(record.data?.latePoVersions ?? []);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  const [file, setFile] = useState<File>(), [poNumber, setPoNumber] = useState(""), [poDate, setPoDate] = useState(""), [poAmount, setPoAmount] = useState(""), [notes, setNotes] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  useUnsavedChanges(open && Boolean(file || poNumber.trim() || notes.trim()));
  if (!allowed) return null;
  const canAttach = session?.user.role === "Coordinator";
  function reset() { setOpen(false); setFile(undefined); setPoNumber(""); setPoDate(""); setPoAmount(""); setNotes(""); setError(""); requestKey.current = crypto.randomUUID(); }
  async function save() {
    const missing = [
      ...(!poNumber.trim() ? ["Enter the customer PO number."] : []),
      ...(!poDate ? ["Enter the PO date."] : []),
      ...(poAmount.trim() && !/^\d{1,13}(\.\d{1,2})?$/.test(poAmount.trim().replace(/,/g, "")) ? ["Enter the PO amount in rupees, for example 900000.00"] : []),
      ...(!file ? ["Choose the customer PO file."] : []),
      ...(file && file.size > 8388608 ? ["Use a file up to 8 MB."] : []),
      ...(!notes.trim() ? ["Enter a note, for example how the PO was received."] : []),
    ];
    if (missing.length) { setError(missing.join(" ")); return; }
    if (!confirmTransition("Attach customer PO", `PO ${poNumber.trim()} will be saved to this site as a new record. The issued IPO and its PDF are not changed.`)) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const upload = await api<any>(`/project-workflow/${record.id}/files`, { csrf: session!.csrfToken, body: { kind: latePoFileKind, filename: file!.name, mime: file!.type, base64: await readBase64(file!) } });
      const current = await api<any>(`/project-workflow/${record.id}`);
      await api(`/project-workflow/${record.id}/actions`, { csrf: session!.csrfToken, body: { version: current.record.version, requestKey: requestKey.current, action: "attach-late-po", input: { fileId: upload.id, poNumber: poNumber.trim(), poDate, poAmount: poAmount.trim().replace(/,/g, ""), notes: notes.trim() } } });
      const after = await api<any>(`/project-workflow/${record.id}`);
      setLatePo(after.record.data.latePo); setVersions(after.record.data.latePoVersions ?? []);
      setSaved(`Customer PO ${poNumber.trim()} attached.`);
      reset();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to attach the customer PO."); }
    finally { setBusy(false); }
  }
  const earlier = versions.filter((v) => v.version !== latePo?.version).reverse();
  return <section className="pz-panel pz-stack" aria-label="Customer PO">
    <h3>Customer PO</h3>
    <p className="pz-caption">{approval ? <>Installation was approved by {record.data.approvalEvidenceType}. The issued IPO keeps that approval; a PO received later is saved beside it.</> : <>The IPO was issued without the customer's PO number. The issued IPO is not changed; the PO received later is saved beside it.</>}</p>
    {latePo ? <LatePoDetails recordId={record.id} latePo={latePo} /> : <p>{record.data.poToFollow ? <StatusBadge tone="pending">Customer PO pending</StatusBadge> : "No customer PO attached."}</p>}
    {earlier.length > 0 && <details><summary>Earlier versions ({earlier.length})</summary>{earlier.map((v) => <LatePoDetails key={v.version} recordId={record.id} latePo={v} />)}</details>}
    {saved && <p role="status">{saved}</p>}
    {canAttach && !open && <div className="pz-action-row"><Button variant={latePo ? "neutral" : "primary"} onClick={() => { setOpen(true); setSaved(""); }}>{latePo ? "Attach corrected PO" : "Attach customer PO"}</Button></div>}
    {canAttach && open && <div className="pz-stack">
      <div className="pz-form-grid">
        <Field id="late-po-number" label="Customer PO number"><input id="late-po-number" value={poNumber} maxLength={100} disabled={busy} onChange={(e) => setPoNumber(e.target.value)} /></Field>
        <Field id="late-po-date" label="PO date"><input id="late-po-date" type="date" value={poDate} disabled={busy} onChange={(e) => setPoDate(e.target.value)} /></Field>
        <Field id="late-po-amount" label="PO amount (optional)" hint="Total including tax, compared with the IPO"><input id="late-po-amount" inputMode="decimal" value={poAmount} disabled={busy} onChange={(e) => setPoAmount(e.target.value)} /></Field>
      </div>
      <Field id="late-po-file" label="Customer PO file" hint="PDF, PNG or JPEG · up to 8 MB"><FileUpload id="late-po-file" accept="application/pdf,image/png,image/jpeg" disabled={busy} selectedFiles={file ? [file] : []} onClear={() => setFile(undefined)} onChange={(e) => setFile(e.target.files?.[0])} /></Field>
      <Field id="late-po-notes" label={latePo ? "Reason for the corrected PO" : "Note"}><textarea id="late-po-notes" rows={3} maxLength={4000} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="pz-action-row">
        <Button variant="primary" loading={busy} loadingLabel="Attaching…" onClick={() => void save()}>Save customer PO</Button>
        <Button variant="neutral" disabled={busy} onClick={reset}>Cancel</Button>
      </div>
    </div>}
  </section>;
}
