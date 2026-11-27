import { ErrorText } from "./parts.js";
import { FileUpload } from "../../ui/FileUpload.js";
import { useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";

export function Upload({
  files = [],
  removableRequestFiles = false,
  session,
  id,
  onSaved,
  initialKind = "Survey report",
  surveyReporting = false,
  dispatchEvidence = false,
}: any) {
  const [kind, setKind] = useState(initialKind),
    [file, setFile] = useState<File>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="pz-panel pz-workflow-form">
      <h3>
        {dispatchEvidence
          ? "Dispatch Evidence"
          : surveyReporting
            ? "Survey report & photos"
            : "Attach source evidence"}
      </h3>
      <p className="pz-caption">
        {dispatchEvidence
          ? "Attach the customer or salesperson delivery confirmation for the approved document."
          : surveyReporting
            ? "Upload the completed survey report and site photographs. These files remain linked to the site."
            : "Attach the original request or supporting document for this site. Saved evidence stays in the document history."}
      </p>
      <div className="pz-form-grid">
        <Field id={`evidence-kind-${id}`} label="Document type">
          <select
            id={`evidence-kind-${id}`}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {(dispatchEvidence
              ? ["Recommendation sending evidence"]
              : surveyReporting
                ? ["Survey report", "Survey photo"]
                : [
                    "Request evidence",
                    "Survey report",
                    "Survey photo",
                    "Recommendation sending evidence",
                    "PO / confirmation",
                    "Heads-up evidence",
                    "Revision evidence",
                  ]
            ).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field
          id={`evidence-file-${id}`}
          label="Attachment"
          hint="PDF, PNG or JPEG · maximum 8 MB"
        >
          <FileUpload selectedFiles={file?[file]:[]} onClear={()=>setFile(undefined)}
            id={`evidence-file-${id}`}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </Field>
      </div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setError("");
          setBusy(true);
          try {
            if (!file) throw new Error("Choose an attachment.");
            if (file.size > 8388608) throw new Error("Use a file up to 8 MB.");
            const base64 = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result).split(",")[1]);
              r.onerror = reject;
              r.readAsDataURL(file);
            });
            await api(`/project-workflow/${id}/files`, {
              csrf: session.csrfToken,
              body: { kind, filename: file.name, mime: file.type, base64 },
            });
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Attach evidence
      </Button>
      {removableRequestFiles && (
        <div className="pz-stack" aria-label="Saved request attachments">
          <h4>Attached files ({files.filter((f: any) => f.kind === "Request evidence").length})</h4>
          <div className="pz-table-scroll"><table><thead><tr><th>File name</th><th>Action</th></tr></thead><tbody>
          {files.filter((f: any) => f.kind === "Request evidence").map((saved: any) => (
            <tr key={saved.id}><td>
              <a href={`/api/project-workflow/${id}/files/${saved.id}`} target="_blank" rel="noreferrer">
                {saved.filename}
              </a></td><td>
              <Button variant="danger" disabled={busy} aria-label={`Remove ${saved.filename}`} onClick={async () => {
                if (!window.confirm(`Remove “${saved.filename}” from this survey request? You can attach it again if needed.`)) return;
                setBusy(true);
                setError("");
                try {
                  await api(`/project-workflow/${id}/files/${saved.id}/remove`, { csrf: session.csrfToken, body: {} });
                  await onSaved();
                } catch (e) { setError((e as Error).message); }
                finally { setBusy(false); }
              }}>Remove</Button>
            </td></tr>
          ))}
          </tbody></table></div>
          {!files.some((f: any) => f.kind === "Request evidence") && <p className="pz-caption">No files attached yet.</p>}
        </div>
      )}
      <ErrorText error={error} />
    </section>
  );
}
