import { useState } from "react";
import { api, type Session } from "../api.js";
import { confirmRevision } from "../confirm.js";
export function ExternalApproval({
  session,
  endpoint,
  onApproved,
}: {
  session: Session;
  endpoint: string;
  onApproved: (row: any) => Promise<void>;
}) {
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
  return (
    <details className="detail-panel">
      <summary>Record WhatsApp / verbal approval</summary>
      <p>
        Attach approval of this exact submitted version. If the approval
        requires changes, create a revision first.
      </p>
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
            <option>Verbal</option>
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
        <button
          disabled={
            busy ||
            !confirmed ||
            (channel === "WhatsApp" && !uploads.length) ||
            !approver.trim() ||
            !comments.trim()
          }
        >
          Record approval & continue
        </button>
      </form>
    </details>
  );
}
