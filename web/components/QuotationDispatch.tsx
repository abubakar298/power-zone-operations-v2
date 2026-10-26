import {FileUpload} from '../ui/FileUpload.js';
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
export function QuotationDispatch({
  session,
  quotationId,
  cniVersionId,
}: {
  session: Session;
  quotationId?: string;
  cniVersionId?: string;
}) {
  const [record, setRecord] = useState<any>(),
    [recipient, setRecipient] = useState("Customer"),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),[file,setFile]=useState<File>(),[uploads,setUploads]=useState<{id:string;filename:string}[]>([]);
  useEffect(() => {
    setRecord(undefined);
    setError("");
    void api<any>(
      `/coordinator/dispatch?${quotationId ? `quotationId=${quotationId}` : `cniVersionId=${cniVersionId}`}`,
    )
      .then((r) => setRecord(r.record))
      .catch((e) => setError(e.message));
  }, [quotationId, cniVersionId]);
  return (
    <section className="detail-panel">
      <h4>Dispatch Approved Quotation</h4>
      {record ? (
        <p role="status">
          Marked sent to {record.recipient}: {record.notes}
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await api("/coordinator/dispatch", {
                csrf: session.csrfToken,
                body: {
                  ...(quotationId ? { quotationId } : { cniVersionId }),
                  recipient,
                  notes,
                  confirmed,
                  evidenceIds:uploads.map(u=>u.id),
                },
              });
              setRecord(r);
              window.dispatchEvent(new Event("pz:workspace-open"));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Approval does not mean the quotation has been sent. Confirm only
            after you send it yourself or hand it to the salesperson.
          </p>
          <Field id="dispatch-recipient" label="Sent to">
            <select
              id="dispatch-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            >
              <option>Customer</option>
              <option>Salesperson</option>
            </select>
          </Field>
          <Field id="dispatch-details" label="Recipient and delivery details">
            <input
              id="dispatch-details"
              required
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field id="dispatch-evidence" label="Dispatch evidence" hint="PDF, PNG or JPEG · maximum 8 MB"><FileUpload selectedFiles={file?[file]:[]} attachments={uploads} onRemoveAttachment={attachment=>setUploads(old=>old.filter(f=>f.id!==attachment.id))} onClear={()=>setFile(undefined)} id="dispatch-evidence" type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0])}/></Field>
          <Button variant="secondary" disabled={!file||busy||uploads.length>=10} onClick={async()=>{setBusy(true);setError('');try{if(!file||file.size>8388608)throw Error('Choose a file up to 8 MB.');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const saved=await api<{id:string;filename:string}>('/survey-uploads',{csrf:session.csrfToken,body:{filename:file.name,mime:file.type,base64}});setUploads(old=>[...old,saved]);setFile(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Upload Dispatch Evidence</Button>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I have sent this approved version to the selected recipient.
          </label>
          <Button
            type="submit"
            loading={busy}
            disabled={!confirmed || !notes.trim()}
          >
            Dispatch Approved Quotation
          </Button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
