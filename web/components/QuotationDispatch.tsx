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
    [error, setError] = useState("");
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
      <h4>Customer delivery confirmation</h4>
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
            Mark quotation sent
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
