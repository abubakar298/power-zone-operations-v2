import { useEffect, useState, useRef } from "react";
import { api, type Session } from "../api.js";
export function Operations({
  session,
  initialIpoId,
}: {
  session: Session;
  initialIpoId?: string;
}) {
  const [orders, setOrders] = useState<any[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [ipoId, setIpoId] = useState(initialIpoId ?? ""),
    [notes, setNotes] = useState(""),
    [source, setSource] = useState<any>(),
    [sourceLoading, setSourceLoading] = useState(false),
    [selected, setSelected] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  async function load() {
    const [o, r] = await Promise.all([
      api<any>("/orders"),
      api<any>("/operations"),
    ]);
    setOrders(o.orders);
    setRows(r.issuances);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let cancelled = false;
    setSource(undefined);
    if (!ipoId) return;
    setSourceLoading(true);
    void api<any>(`/operations/sources/${ipoId}`)
      .then((r) => {
        if (!cancelled) setSource(r.snapshot);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ipoId]);
  const pending = orders.filter((o) => !rows.some((r) => r.ipo_id === o.id));
  async function send() {
    setBusy(true);
    setError("");
    try {
      const signature = JSON.stringify({ ipoId, notes });
      if (request.current?.signature !== signature)
        request.current = { signature, key: crypto.randomUUID() };
      const row = await api<any>("/operations", {
        body: { ipoId, notes, requestKey: request.current!.key },
        csrf: session.csrfToken,
      });
      request.current = undefined;
      setSelected(row);
      setIpoId("");
      setNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to issue BOQ.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-panel operations-panel">
      <h2>BOQ issuance to Operations</h2>
      <p>
        Send the approved site requirements after IPO creation. Operations will
        arrange delivery and the Store handoff.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="operations-form"
      >
        <label>
          Saved IPO
          <select
            required
            value={ipoId}
            onChange={(e) => setIpoId(e.target.value)}
          >
            <option value="">Select an IPO awaiting Operations issuance</option>
            {pending.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} · {o.customer} · {o.quotation_number}
              </option>
            ))}
          </select>
        </label>
        <label>
          Instructions to Operations
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button
          className="dark-button"
          disabled={busy || !ipoId || !source || sourceLoading}
        >
          {busy ? "Sending…" : "Send BOQ to Operations"}
        </button>
      </form>
      {source && (
        <section>
          <h3>Requirements to send</h3>
          <p>
            {source.customer.name} · {source.siteName} / {source.siteCode} ·{" "}
            {source.boqNumber}
          </p>
          <p>
            Delivery address: {source.deliveryAddress || "Need to enter"} · Site
            contact: {source.siteContact} {source.sitePhone}
          </p>
          <p>
            {source.items.length} required BOQ lines from the approved revision.
          </p>
          <div className="order-table-scroll">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Specification</th>
                  <th>Brand</th>
                  <th>Qty</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {source.items.map((l: any, i: number) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td>{l.specification || "Need to enter"}</td>
                    <td>
                      {l.brand === "Any of the Above"
                        ? l.brandAlternatives?.join(" / ")
                        : l.brand}
                    </td>
                    <td>{l.qty}</td>
                    <td>{l.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <h3>Issued requirements</h3>
      {rows.length === 0 ? (
        <p>No BOQs issued to Operations yet.</p>
      ) : (
        <div className="order-table-scroll">
          <table className="order-table">
            <thead>
              <tr>
                <th>Issuance</th>
                <th>Customer / site</th>
                <th>IPO / BOQ</th>
                <th>Issued by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.number}</td>
                  <td>
                    {r.snapshot.customer.name}
                    <br />
                    {r.snapshot.siteName} / {r.snapshot.siteCode}
                  </td>
                  <td>
                    {r.snapshot.ipoNumber}
                    <br />
                    {r.snapshot.boqNumber}
                  </td>
                  <td>{r.snapshot.issuedBy}</td>
                  <td>
                    <button
                      className="workflow-button"
                      onClick={() => setSelected(r)}
                    >
                      View
                    </button>
                    <a
                      href={`/api/operations/${r.id}/report.pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download BOQ issuance
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <section>
          <h3>{selected.number}</h3>
          <p>
            {selected.snapshot.customer.name} · {selected.snapshot.siteName} ·{" "}
            {selected.snapshot.ipoNumber}
          </p>
          <p>
            Delivery address:{" "}
            {selected.snapshot.deliveryAddress || "Need to enter"}
          </p>
          <p>
            Site contact: {selected.snapshot.siteContact}{" "}
            {selected.snapshot.sitePhone}
          </p>
          <p>{selected.snapshot.notes}</p>
          <div className="order-table-scroll">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Specification</th>
                  <th>Brand</th>
                  <th>Qty</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {selected.snapshot.items.map((l: any, i: number) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td>{l.specification || "Need to enter"}</td>
                    <td>
                      {l.brand === "Any of the Above"
                        ? l.brandAlternatives?.join(" / ")
                        : l.brand}
                    </td>
                    <td>{l.qty}</td>
                    <td>{l.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
