import { useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";

export function NewCustomer({
  session,
  onCreated,
  onClose,
  onLogout,
}: {
  session: Session;
  onCreated: (id: string) => Promise<void>;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      [
        "name",
        "short_code",
        "contact_person",
        "phone",
        "email",
        "address",
        "notes",
      ].map((key) => [key, String(form.get(key) ?? "")]),
    );
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/masters/customers", {
        body: {
          id: "new",
          version: 0,
          values: { ...values, status: "Active" },
        },
        csrf: session.csrfToken,
      });
      await onCreated(result.id);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError(e instanceof Error ? e.message : "Unable to add customer.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="master-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-boq-customer-title"
      >
        <h2 id="new-boq-customer-title">Add customer</h2>
        <p>Create a customer and continue with this BOQ.</p>
        <form onSubmit={save}>
          {(
            [
              ["name", "Customer name"],
              ["short_code", "Short code"],
              ["contact_person", "Contact person"],
              ["phone", "Phone"],
              ["email", "Email"],
              ["address", "Address"],
              ["notes", "Notes"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              {key === "address" || key === "notes" ? (
                <textarea name={key} maxLength={2000} disabled={busy} />
              ) : (
                <input
                  name={key}
                  type={key === "email" ? "email" : "text"}
                  maxLength={
                    key === "short_code"
                      ? 30
                      : key === "phone"
                        ? 100
                        : key === "email"
                          ? 254
                          : 200
                  }
                  required={key === "name" || key === "short_code"}
                  autoFocus={key === "name"}
                  disabled={busy}
                />
              )}
            </label>
          ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="dark-button" disabled={busy}>
              {busy ? "Saving…" : "Add customer & continue"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
