import { useEffect, useState, useRef } from "react";
import { api, type Session } from "../api.js";
type DeliveryDetails = {
  deliveryAddress: string;
  siteContact: string;
  sitePhone: string;
  deliveryDate: string;
  deliveryTime: string;
  instructions: string;
};
const deliveryFields: [keyof DeliveryDetails, string][] = [
  ["deliveryAddress", "Delivery address"],
  ["siteContact", "Contact person on site"],
  ["sitePhone", "Site contact number"],
  ["deliveryDate", "Delivery date"],
  ["deliveryTime", "Delivery time"],
  ["instructions", "Delivery instructions"],
];
export function Operations({
  session,
  initialIpoId,
  portal = false,
}: {
  session: Session;
  initialIpoId?: string;
  portal?: boolean;
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
  const [workspace, setWorkspace] = useState<"handoff" | "received">(
    portal || session.user.role === "Operations" ? "received" : "handoff",
  );
  const [portalData, setPortalData] = useState<any>();
  const [bucket, setBucket] = useState("Received BOQs");
  const storeKey = useRef<string | undefined>(undefined);
  const [plan, setPlan] = useState<any>();
  const [details, setDetails] = useState<DeliveryDetails>({
    deliveryAddress: "",
    siteContact: "",
    sitePhone: "",
    deliveryDate: "",
    deliveryTime: "",
    instructions: "",
  });
  const [planReady, setPlanReady] = useState(false);
  const [planLoading, setPlanLoading] = useState(false),
    [message, setMessage] = useState("");
  const planRequest = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    let cancelled = false;
    setPlan(undefined);
    setPlanReady(false);
    setError("");
    setMessage("");
    if (!selected || workspace !== "received") return;
    setPlanLoading(true);
    void api<any>(`/operations/${selected.id}/delivery-plan`)
      .then((r) => {
        if (cancelled) return;
        setPlan(r.plan);
        setPlanReady(true);
        setDetails(
          r.plan?.details ?? {
            deliveryAddress: selected.snapshot.deliveryAddress || "",
            siteContact: selected.snapshot.siteContact || "",
            sitePhone: selected.snapshot.sitePhone || "",
            deliveryDate: "",
            deliveryTime: "",
            instructions: "",
          },
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, workspace]);
  async function savePlan() {
    if (!planReady || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const signature = JSON.stringify({
        id: selected.id,
        version: plan?.version ?? 0,
        details,
      });
      if (signature !== planRequest.current?.signature)
        planRequest.current = { signature, key: crypto.randomUUID() };
      const row = await api<any>(`/operations/${selected.id}/delivery-plan`, {
        body: {
          version: plan?.version ?? 0,
          details,
          requestKey: planRequest.current!.key,
        },
        csrf: session.csrfToken,
      });
      setPlan(row);
      planRequest.current = undefined;
      setMessage("Delivery details saved by Operations.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save delivery details.",
      );
    } finally {
      setBusy(false);
    }
  }
  const request = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  async function load() {
    const [o, r] = await Promise.all([
      api<any>("/orders"),
      api<any>("/operations/portal"),
    ]);
    setOrders(o.orders);
    setRows(r.issuances);
    setPortalData(r);
    setSelected((v: any) =>
      v ? (r.issuances.find((row: any) => row.id === v.id) ?? v) : v,
    );
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
  const isOperations = ["Admin", "Management", "Operations"].includes(
    session.user.role,
  );
  const bucketRows = rows.filter((r) =>
    bucket === "Delivery planning"
      ? !r.delivery_plan_id && !r.store_issuance_id
      : bucket === "Ready for Store"
        ? r.delivery_plan_id && !r.store_issuance_id
        : bucket === "Sent to Store"
          ? r.store_issuance_id
          : true,
  );
  async function sendStore() {
    if (!selected || !plan || busy) return;
    setBusy(true);
    setError("");
    storeKey.current ??= crypto.randomUUID();
    try {
      await api(`/operations/${selected.id}/send-to-store`, {
        body: { deliveryPlanId: plan.id, requestKey: storeKey.current },
        csrf: session.csrfToken,
      });
      storeKey.current = undefined;
      setMessage("BOQ issued to Store with the saved delivery plan.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to issue to Store.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-panel operations-panel">
      {(portal || workspace === "received") && (
        <section aria-label="Operations buckets">
          <h2>Operations delivery portal</h2>
          <p>
            Delivery planning and Store preparation · Hamza Mir & Moaz Ahsan
          </p>
          <div className="stage-grid">
            {[
              "Issued IPOs",
              "Received BOQs",
              "Delivery planning",
              "Ready for Store",
              "Sent to Store",
              "Stock demand",
            ].map((name) => (
              <button
                key={name}
                className={`stage-card ${bucket === name ? "selected" : ""}`}
                aria-pressed={bucket === name}
                onClick={() => {
                  setBucket(name);
                  setSelected(undefined);
                  setWorkspace("received");
                }}
              >
                <strong>{name}</strong>
                <span>
                  {name === "Issued IPOs"
                    ? (portalData?.ipos.length ?? 0)
                    : name === "Stock demand"
                      ? (portalData?.demand.length ?? 0)
                      : rows.filter((r) =>
                          name === "Delivery planning"
                            ? !r.delivery_plan_id && !r.store_issuance_id
                            : name === "Ready for Store"
                              ? r.delivery_plan_id && !r.store_issuance_id
                              : name === "Sent to Store"
                                ? r.store_issuance_id
                                : true,
                        ).length}
                </span>
              </button>
            ))}
          </div>
          {bucket === "Issued IPOs" && (
            <div className="order-table-scroll">
              <table className="order-table">
                <thead>
                  <tr>
                    <th>IPO</th>
                    <th>Customer / site</th>
                    <th>BOQ receipt</th>
                    <th>Document</th>
                  </tr>
                </thead>
                <tbody>
                  {portalData?.ipos.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.number}</td>
                      <td>
                        {i.customer}
                        <br />
                        {i.site}
                      </td>
                      <td>
                        {i.issuance_id
                          ? "BOQ received"
                          : "Awaiting coordinator handoff"}
                      </td>
                      <td>
                        <a
                          href={`/api/orders/${i.id}/ipo.pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View IPO
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {bucket === "Stock demand" && (
            <>
              <p>
                Required quantities from issued BOQs. Sending to Store tracks
                requested preparation; it does not reduce physical stock.
                Procurement and stock-on-hand reconciliation follow later.
              </p>
              <div className="order-table-scroll">
                <table className="order-table">
                  <thead>
                    <tr>
                      <th>Item / specification</th>
                      <th>Brand</th>
                      <th>Unit</th>
                      <th>Required</th>
                      <th>Awaiting Store</th>
                      <th>Sent to Store</th>
                      <th>Sites</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portalData?.demand.map((d: any, index: number) => (
                      <tr key={index}>
                        <td>
                          {d.item_key}
                          <br />
                          {d.specification}
                        </td>
                        <td>{d.brand}</td>
                        <td>{d.unit}</td>
                        <td>{d.required_quantity}</td>
                        <td>{d.awaiting_store_quantity}</td>
                        <td>{d.sent_to_store_quantity}</td>
                        <td>{d.sites}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      <div
        className="master-tabs"
        role="tablist"
        aria-label="Operations workspaces"
      >
        {session.user.role !== "Operations" && (
          <button
            role="tab"
            aria-selected={workspace === "handoff"}
            className={workspace === "handoff" ? "selected" : ""}
            disabled={busy}
            onClick={() => {
              setWorkspace("handoff");
              setSelected(undefined);
            }}
          >
            Coordinator handoff
          </button>
        )}
        <button
          role="tab"
          aria-selected={workspace === "received"}
          className={workspace === "received" ? "selected" : ""}
          disabled={busy}
          onClick={() => {
            setWorkspace("received");
            setSelected(undefined);
          }}
        >
          Operations · Received BOQs
        </button>
      </div>
      <h2>
        {workspace === "handoff"
          ? "BOQ issuance to Operations"
          : "Operations · Received BOQs"}
      </h2>
      <p>
        Send the approved site requirements after IPO creation. Operations will
        arrange delivery and the Store handoff.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {workspace === "handoff" && (
        <>
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
                <option value="">
                  Select an IPO awaiting Operations issuance
                </option>
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
                {source.items.length} required BOQ lines from the approved
                revision.
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
        </>
      )}
      <h3>
        {workspace === "handoff"
          ? "Issued requirements"
          : "Received site requirements"}
      </h3>
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
              {(workspace === "received" ? bucketRows : rows).map((r) => (
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
                      disabled={busy}
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
          {workspace === "received" && (
            <section className="ipo-customer-summary">
              <h3>Delivery planning · Operations</h3>
              <p>
                Collect these details after BOQ receipt. The original BOQ and
                IPO stay unchanged.
              </p>
              {message && (
                <p role="status" className="success">
                  {message}
                </p>
              )}
              {planLoading ? (
                <p role="status">Loading delivery details…</p>
              ) : !planReady ? (
                <p>
                  Unable to load delivery details. Reopen this BOQ to try again.
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void savePlan();
                  }}
                >
                  <fieldset
                    className="order-fields"
                    disabled={
                      busy ||
                      planLoading ||
                      !!selected.store_issuance_id ||
                      !isOperations
                    }
                  >
                    {deliveryFields.map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          type={
                            key === "deliveryDate"
                              ? "date"
                              : key === "deliveryTime"
                                ? "time"
                                : "text"
                          }
                          required={
                            !["deliveryTime", "instructions"].includes(key)
                          }
                          maxLength={
                            key === "deliveryAddress"
                              ? 1000
                              : key === "instructions"
                                ? 2000
                                : 300
                          }
                          value={details[key]}
                          onChange={(e) =>
                            setDetails((v) => ({ ...v, [key]: e.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </fieldset>
                  <button
                    className="dark-button"
                    disabled={
                      busy || !!selected.store_issuance_id || !isOperations
                    }
                  >
                    Save delivery details
                  </button>
                  {plan && (
                    <p>
                      Saved version {plan.version} ·{" "}
                      {new Date(plan.created_at).toLocaleString("en-PK")}
                    </p>
                  )}
                </form>
              )}
              {selected.store_issuance_id ? (
                <p>
                  Issued to Store: <strong>{selected.store_number}</strong> ·{" "}
                  <a
                    href={`/api/operations/store/${selected.store_issuance_id}/report.pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download Store BOQ
                  </a>
                </p>
              ) : (
                isOperations && (
                  <button
                    className="dark-button"
                    disabled={
                      busy ||
                      !planReady ||
                      !plan ||
                      !deliveryFields.every(
                        ([key]) => details[key] === plan.details[key],
                      )
                    }
                    onClick={() => void sendStore()}
                  >
                    Issue BOQ to Store
                  </button>
                )
              )}
            </section>
          )}
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
