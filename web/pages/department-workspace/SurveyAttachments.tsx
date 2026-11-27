import { ErrorText } from "./parts.js";
import { recentFirst } from "../../../shared/recent-records.js";
import { PagedTableBody } from "../../ui/PagedTableBody.js";
import { FileUpload } from "../../ui/FileUpload.js";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges.js";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";

export function SitePicturesFolder({session, record, onSaved, readOnly = false}: any) {
  const saved = record.data.sitePictureFolder?.url ?? "";
  const [url, setUrl] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setUrl(saved), [saved]);
  return <section className="pz-stack">
    <h4>Site Pictures & Videos</h4>
    {saved && <a href={saved} target="_blank" rel="noopener noreferrer">Open site folder in Google Drive</a>}
    {!readOnly && <>
      <Field id={`site-folder-${record.id}`} label="Google Drive site folder" hint="Pictures and videos remain in Drive. This saves the folder link only.">
        <input id={`site-folder-${record.id}`} type="url" value={url} onChange={e=>{setUrl(e.target.value);setNotice("");}} disabled={busy}/>
      </Field>
      <div><Button variant="secondary" loading={busy} disabled={!url.trim() || url.trim()===saved} onClick={async()=>{
        setBusy(true);setError("");setNotice("");
        try{await api(`/project-workflow/${record.id}/actions`,{csrf:session.csrfToken,body:{action:"save-site-picture-link",version:record.version,requestKey:crypto.randomUUID(),input:{url}}});await onSaved();setNotice("Site folder link saved.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>Save Folder Link</Button></div>
      {notice && <p role="status">{notice}</p>}<ErrorText error={error}/>
    </>}
    {readOnly && !saved && <p>No site folder link saved.</p>}
  </section>;
}
export function SurveyReportAttachments({ session, id, record, files = [], onSaved }: any) {
  return (
    <section className="pz-panel pz-stack">
      <h3>Survey Form & Site Pictures</h3>
      <p>
        Attach the survey report, BOQ input form and load assessment report.
        Save the site's Drive folder link for pictures and videos.
      </p>
      <div className="pz-form-grid">
        <SurveyAttachmentGroup
          session={session}
          id={id}
          kind="Survey report"
          title="Attach Survey Report"
          existing={files.filter((f: any) => f.kind === "Survey report")}
          onSaved={onSaved}
        />
        <SitePicturesFolder {...{session,record,onSaved}}/>
      </div>
      {files.some((f:any)=>f.kind==="Survey photo") && <details><summary>Previously Uploaded Site Pictures</summary>{files.filter((f:any)=>f.kind==="Survey photo").map((f:any)=><p key={f.id}><a href={`/api/project-workflow/${id}/files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.filename}</a></p>)}</details>}
    </section>
  );
}
export function SurveyAttachmentGroup({
  session,
  id,
  kind,
  title,
  existing,
  onSaved,
}: any) {
  const [selected, setSelected] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useUnsavedChanges(selected.length > 0);
  const pictures = kind === "Survey photo";
  return (
    <section className="pz-stack">
      <h4>{title}</h4>
      <Field
        id={`survey-upload-${id}-${pictures ? "photos" : "report"}`}
        label={pictures ? "Site pictures" : "Survey report files"}
        hint={`${existing.length}/10 files saved · maximum 8 MB per file`}
      >
        <FileUpload selectedFiles={selected} onClear={()=>setSelected([])}
          ref={input}
          id={`survey-upload-${id}-${pictures ? "photos" : "report"}`}
          type="file"
          multiple
          disabled={busy}
          accept={
            pictures
              ? "image/png,image/jpeg"
              : "application/pdf,image/png,image/jpeg"
          }
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            setNotice("");
            setError("");
            if (chosen.length + existing.length > 10) {
              setError("You can attach up to 10 files in this section.");
              setSelected([]);
              e.target.value = "";
              return;
            }
            if (chosen.some((f) => f.size > 8388608)) {
              setError("Each file must be 8 MB or smaller.");
              setSelected([]);
              e.target.value = "";
              return;
            }
            setSelected(chosen);
          }}
        />
      </Field>
      {selected.length > 0 && (
        <p>
          {selected.length} selected: {selected.map((f) => f.name).join(", ")}
        </p>
      )}
      <div>
        <Button
          variant="primary"
          loading={busy}
          disabled={!selected.length || existing.length >= 10}
          onClick={async () => {
            setError("");
            setNotice("");
            setBusy(true);
            let uploaded = 0;
            try {
              for (const file of selected) {
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]);
                  reader.onerror = () =>
                    reject(new Error("Unable to read " + file.name));
                  reader.readAsDataURL(file);
                });
                await api(`/project-workflow/${id}/files`, {
                  csrf: session.csrfToken,
                  body: { kind, filename: file.name, mime: file.type, base64 },
                });
                uploaded++;
              }
              setSelected([]);
              if (input.current) input.current.value = "";
              setNotice(
                `${uploaded} file${uploaded === 1 ? "" : "s"} attached.`,
              );
              await onSaved();
            } catch (e) {
              setSelected(selected.slice(uploaded));
              setError((e as Error).message);
              if (uploaded) {
                setNotice(`${uploaded} files saved before the error.`);
                await onSaved().catch(() => {});
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {title}
        </Button>
        <ErrorText error={error} />
      </div>
      {notice && <p role="status">{notice}</p>}
      {existing.length > 0 && (
        <ul>
          {existing.map((file: any) => (
            <li key={file.id}>
              <a
                href={`/api/project-workflow/${id}/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {file.filename}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function SurveySubmissionGroups({ session, groups, onSent }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const request = useRef<{ signature: string; key: string } | null>(null);
  async function send(group: any) {
    if (
      !window.confirm(
        `Send ${group.number} with ${group.siteCount} site(s), its combined report and UBL Excel to Management? Branch codes: ${group.sites.map((s: any) => s.siteCode).join(", ")}`,
      )
    )
      return;
    setBusy(group.id);
    setError(null);
    const ids = group.sites.map((s: any) => s.recordId),
      signature = JSON.stringify({ groupId: group.id, ids });
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      await api("/project-workflow/ubl-survey-packages", {
        csrf: session.csrfToken,
        body: {
          groupId: group.id,
          recordIds: ids,
          submit: true,
          remarks: `Survey Submission Group ${group.number}`,
          requestKey: request.current!.key,
        },
      });
      await onSent();
    } catch (e) {
      setError({ id: group.id, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="pz-panel">
      <h2>Combined Surveys — Ready for Management</h2>
      {!groups.length ? (
        <p>No survey submission groups waiting to be sent.</p>
      ) : (
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Submission Group</th>
                <th>Sites</th>
                <th>Branch Codes / Sites</th>
                <th>Action</th>
              </tr>
            </thead>
            <PagedTableBody label="sites and documents">
              {recentFirst(groups).map((group: any) => (
                <tr key={group.id}>
                  <td>
                    <strong>{group.number}</strong>
                  </td>
                  <td>{group.siteCount}</td>
                  <td>
                    {group.sites.map((site: any) => (
                      <div key={site.recordId}>
                        {site.siteCode} · {site.siteName}
                      </div>
                    ))}
                  </td>
                  <td>
                    <div className="pz-action-row">
                      <Button
                        variant="primary"
                        loading={busy === group.id}
                        disabled={!!busy}
                        loadingLabel="Preparing report & Excel…"
                        onClick={() => void send(group)}
                      >
                        Send to Management
                      </Button>
                      <a
                        href={`/api/project-workflow/survey-submission-groups/${group.id}/xlsx`}
                      >
                        Download Excel
                      </a>
                    </div>
                    {error?.id === group.id && (
                      <ErrorText error={error?.message ?? ""} />
                    )}
                  </td>
                </tr>
              ))}
            </PagedTableBody>
          </table>
        </div>
      )}
    </section>
  );
}
export function UblSurveyPackageActions({ session, record, onSaved }: any) {
  const selected = [record.id];
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<"save" | "send" | null>(null);
  const request = useRef<{ signature: string; key: string } | null>(null);
  async function submit(send: boolean) {
    if (
      send &&
      !window.confirm(
        "Send this site’s report and UBL Excel to Management? This survey will leave Design Outputs.",
      )
    )
      return;
    const mode = send ? "send" : "save";
    setBusy(mode);
    setError("");
    setFailed(null);
    const signature = JSON.stringify({
      recordIds: selected,
      submit: send,
      remarks,
    });
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await api<any>("/project-workflow/ubl-survey-packages", {
        csrf: session.csrfToken,
        body: {
          recordIds: selected,
          submit: send,
          remarks,
          requestKey: request.current!.key,
        },
      });
      await onSaved(result.status);
    } catch (e) {
      setError((e as Error).message);
      setFailed(mode);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="pz-panel">
      <h2>UBL Report & Excel</h2>
      <p>
        Save this site’s report and Excel information for later bulking, or send
        this site individually to Management.
      </p>
      <Field id="ubl-package-remarks" label="Remarks">
        <textarea
          id="ubl-package-remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          disabled={!!busy}
        />
      </Field>
      <div className="pz-survey-save-actions">
        <div>
          <Button
            variant="secondary"
            disabled={!!busy || !selected.length}
            loading={busy === "save"}
            onClick={() => void submit(false)}
          >
            Save to Send Together
          </Button>
          {failed === "save" && <ErrorText error={error} />}
        </div>
        <div>
          <Button
            variant="primary"
            disabled={!!busy || !selected.length}
            loading={busy === "send"}
            loadingLabel="Preparing report & Excel…"
            onClick={() => void submit(true)}
          >
            Send Report & UBL Excel to Management
          </Button>
          {failed === "send" && <ErrorText error={error} />}
        </div>
      </div>
    </section>
  );
}
