import {Field} from "../ui/Field.js";
import { Button } from "../ui/Button.js";
import { useState } from "react";
import { api, type Session } from "../api.js";
import { confirmRevision } from "../confirm.js";
export function ExternalApproval({
  session,
  endpoint,
  onApproved,
  preauthorized = false,
  expanded = false,
  quotationApproval = false,
}: {
  preauthorized?: boolean;
  expanded?: boolean;
  quotationApproval?: boolean;
  session: Session;
  endpoint: string;
  onApproved: (row: any) => Promise<void>;
}) {
  const [decisionAt, setDecisionAt] = useState("");
  const [channel, setChannel] = useState("WhatsApp");
  const [approver, setApprover] = useState(""),
    [comments, setComments] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [uploads, setUploads] = useState<{ id: string; filename: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 8388608 ||
      uploads.length >= 10
    ) {
      setError("Attach up to 10 PNG/JPEG screenshots, each up to 8 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const row = await api<{ id: string; filename: string }>(
        "/survey-uploads",
        {
          body: { filename: file.name, mime: file.type, base64 },
          csrf: session.csrfToken,
        },
      );
      setUploads((old) => [...old, row]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (
      !(await confirmRevision(
        "Record external approval",
        "Confirm the recorded approval covers this exact document and its current values. This advances the workflow and preserves the approval record.",
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const row = await api(endpoint, {
        body: {
          channel,
          approver,
          comments,
          evidenceIds: uploads.map((u) => u.id),
          confirmed,
          ...(decisionAt
            ? { decisionAt: new Date(decisionAt).toISOString() }
            : {}),
          ...(endpoint.startsWith("/orders/")
            ? { requestKey: crypto.randomUUID() }
            : {}),
        },
        csrf: session.csrfToken,
      });
      await onApproved(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record approval.");
    } finally {
      setBusy(false);
    }
  }
  if(quotationApproval) return <form className="pz-stack pz-workflow-form" aria-label="Quotation approval evidence" onSubmit={e=>{e.preventDefault();void submit();}}>
    <div><h3>Record Quotation Approval</h3><p className="pz-caption">Attach Management approval for this saved quotation. Submission moves it to Ready to Send.</p></div>
    <div className="pz-form-grid">
      <Field id="quotation-approver" label="Approved by" hint="Management approver's name."><input id="quotation-approver" required maxLength={100} value={approver} onChange={e=>setApprover(e.target.value)}/></Field>
      <Field id="quotation-approval-date" label="Approval date / time" hint="Optional. Recording time is saved automatically."><input id="quotation-approval-date" type="datetime-local" value={decisionAt} onChange={e=>setDecisionAt(e.target.value)}/></Field>
      <div className="pz-field-wide"><Field id="quotation-approval-remarks" label="Approval remarks" hint="Confirm which quotation and terms were approved."><textarea id="quotation-approval-remarks" required rows={3} maxLength={2000} value={comments} onChange={e=>setComments(e.target.value)}/></Field></div>
      <div className="pz-field-wide"><Field id="quotation-approval-evidence" label="Attach approval evidence" hint="WhatsApp screenshot · PNG or JPEG · up to 10 files, 8 MB each."><input id="quotation-approval-evidence" type="file" accept="image/png,image/jpeg" disabled={busy||uploads.length>=10} onChange={e=>{void upload(e.target.files?.[0]);e.target.value="";}}/></Field></div>
    </div>
    {uploads.length>0&&<ul className="pz-stack">{uploads.map(u=><li key={u.id} className="pz-action-row"><span>{u.filename}</span><Button variant="neutral" disabled={busy} onClick={()=>setUploads(old=>old.filter(v=>v.id!==u.id))}>Remove</Button></li>)}</ul>}
    <label className="pz-review-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this evidence approves this exact quotation without changes.</label>
    <div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="pz-action-row"><Button variant="success" type="submit" loading={busy} disabled={!confirmed||!uploads.length||!approver.trim()||!comments.trim()}>Submit Approval — Ready to Send</Button></div></div>
  </form>;
  return (
    <details className="detail-panel" open={expanded || undefined}>
      <summary>
        {quotationApproval ? "Record Quotation Approval" : preauthorized
          ? "Use Management-approved discount instruction"
          : "Record WhatsApp / verbal approval"}
      </summary>
      <p>{quotationApproval ? "Attach Management approval for this exact quotation. Submitting records the evidence and moves it to Ready to Send." : "Attach Management approval of this exact saved version, including its special discount and final payable. First-issued R1 quotations can use a prior instruction. If the values differ, save a revision first."}</p>
      <form
        aria-label="WhatsApp approval evidence"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Approval method
          <select
            aria-label="Approval method"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option>WhatsApp</option>
            {!preauthorized && <option>Verbal</option>}
          </select>
        </label>
        {channel === "Verbal" && (
          <p>
            Record the approver and the conversation details. This will be
            recorded as verbal approval.
          </p>
        )}
        <label>
          Approver name
          <input
            required
            maxLength={100}
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
          />
        </label>
        <label>
          Approval decision date / time (if known)
          <input
            type="datetime-local"
            value={decisionAt}
            onChange={(e) => setDecisionAt(e.target.value)}
          />
          <small>
            Leave blank if unavailable. The recording time is saved separately.
          </small>
        </label>
        <label>
          Approval remarks
          <textarea
            required
            maxLength={2000}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </label>
        <label>
          Approval screenshot
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <ul>
          {uploads.map((u) => (
            <li key={u.id}>
              {u.filename}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setUploads((old) => old.filter((v) => v.id !== u.id))
                }
              >
                Remove screenshot
              </button>
            </li>
          ))}
        </ul>
        <label>
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm this evidence approves this exact document without changes.
        </label>
        {error && <p role="alert">{error}</p>}
        <Button
          variant="primary"
          type="submit"
          disabled={
            busy ||
            !confirmed ||
            (channel === "WhatsApp" && !uploads.length) ||
            !approver.trim() ||
            !comments.trim()
          }
        >
          {quotationApproval ? "Submit Approval — Ready to Send" : "Record approval & continue"}
        </Button>
      </form>
    </details>
  );
}
