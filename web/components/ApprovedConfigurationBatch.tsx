import { useEffect, useRef, useState } from "react";
import { defaultIpoInvoiceTerms, ipoInvoiceTermsLabels, type IpoInvoiceTerms } from "../../shared/ipo-invoice-terms.js";
import { IpoInvoiceTermsField } from "./IpoInvoiceTermsField.js";
import { Decimal } from "decimal.js";
import { api } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { FileUpload } from "../ui/FileUpload.js";
import { DocumentPreview } from "./DocumentPreview.js";
import { confirmTransition } from "../confirm.js";
import { money } from "../numbers.js";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
const empty = () => ({
  key: crypto.randomUUID(),
  siteName: "",
  siteCode: "",
  siteAddress: "",
  region: "",
  frameworkId: "",
});
function pdf(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "application/pdf" });
}
export function ApprovedConfigurationBatch({
  refs,
  session,
  route,
  onCancel,
  onOpen,
}: any) {
  const direct = route === "direct-framework",
    ubl = refs.customers.find(
      (c: any) => c.short_code?.toUpperCase() === "UBL",
    );
  const choices = refs.frameworks.filter(
    (f: any) =>
      f.customer_id === ubl?.id &&
      ["ubl-solar", "ubl-bess-installation"].includes(f.type) &&
      f.routes?.includes(route),
  );
  const [rows, setRows] = useState([empty()]),
    [notes, setNotes] = useState(""),
    [reference, setReference] = useState(""),
    [date, setDate] = useState(""),
    [poTotal, setPoTotal] = useState(""),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<any>(),
    [reviewed, setReviewed] = useState(false),
    [batchTerms, setBatchTerms] = useState<IpoInvoiceTerms | "">(""),
    [siteTerms, setSiteTerms] = useState<Record<string, IpoInvoiceTerms | "">>({}),
    [document, setDocument] = useState<{ title: string; data: Blob }>();
  const cacheKey =
    "pz:approved-configuration-batch:" + session.user.id + ":" + route;
  useEffect(() => {
    const id = sessionStorage.getItem(cacheKey);
    if (id)
      void api<any>("/project-workflow/configuration-batches/" + id)
        .then(setSaved)
        .catch(() => sessionStorage.removeItem(cacheKey));
  }, [cacheKey]);
  const createKey = useRef(crypto.randomUUID()),
    confirmKey = useRef(crypto.randomUUID());
  useUnsavedChanges(!saved && rows.some((r) => r.siteName || r.siteCode));
  const total = rows.reduce(
    (sum, r) =>
      sum.add(
        choices.find((f: any) => f.id === r.frameworkId)?.total_including_gst ??
          0,
      ),
    new Decimal(0),
  );
  function termsFor(site: { id: string; framework?: { key?: string } }) {
    return siteTerms[site.id] || batchTerms || defaultIpoInvoiceTerms(site.framework?.key);
  }
  function change(key: string, field: string, value: string) {
    setRows((old) =>
      old.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
    setError("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (!ubl) throw Error("The active UBL customer is unavailable.");
      if (
        rows.some(
          (r) =>
            !r.siteName.trim() ||
            !r.siteCode.trim() ||
            (direct && !r.frameworkId),
        )
      )
        throw Error(
          direct
            ? "Enter the site name, branch code and approved configuration on every row."
            : "Enter the site name and branch code on every row.",
        );
      if (!notes.trim()) throw Error("Enter the original request / notes.");
      if (direct && (!file || !reference.trim() || !date || !poTotal))
        throw Error(
          "Enter the shared PO reference, date, amount and original attachment.",
        );
      const evidence = file
        ? await new Promise<any>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () =>
              resolve({
                filename: file.name,
                mime: file.type,
                base64: String(reader.result).split(",")[1],
              });
            reader.readAsDataURL(file);
          })
        : undefined;
      const created = await api<any>(
        "/project-workflow/configuration-batches",
        {
          csrf: session.csrfToken,
          body: {
            requestKey: createKey.current,
            customerId: ubl.id,
            route,
            notes,
            rows: rows.map(({ key, frameworkId, ...r }) => ({
              ...r,
              ...(direct ? { frameworkId } : {}),
            })),
            ...(evidence ? { evidence } : {}),
            ...(direct ? { po: { reference, date, total: poTotal } } : {}),
          },
        },
      );
      sessionStorage.setItem(cacheKey, created.id);
      setSaved(
        await api<any>("/project-workflow/configuration-batches/" + created.id),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    setError("");
    try {
      setSaved(
        await api<any>(
          "/project-workflow/configuration-batches/" + saved.id + "/preview",
          { csrf: session.csrfToken, body: {} },
        ),
      );
      setReviewed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!reviewed) return;
    const invoiceTermsBySite = Object.fromEntries(saved.records.map((site: { id: string; framework?: { key?: string } }) => [site.id, termsFor(site)]));
    if (Object.values(invoiceTermsBySite).some(value => !value)) {
      setError("Select invoice terms for every site before issuing the batch.");
      return;
    }
    if (
      !confirmTransition(
        "Issue batch IPOs and PT",
        "Issue one site order per reviewed configuration, linked to this single customer PO, and share them with Accounts and Operations?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/project-workflow/configuration-batches/" + saved.id + "/confirm",
        {
          csrf: session.csrfToken,
          body: {
            requestKey: confirmKey.current,
            fingerprint: saved.fingerprint,
            reviewed: true,
            invoiceTermsBySite,
          },
        },
      );
      setSaved(
        await api("/project-workflow/configuration-batches/" + saved.id),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="pz-panel pz-stack"
      aria-label={direct ? "Approved Direct PO batch" : "Approved survey batch"}
    >
      <div className="pz-action-row">
        <Button variant="neutral" onClick={onCancel}>
          Back
        </Button>
      </div>
      <h2>
        {direct ? "Direct PO · multiple sites" : "Pre-agreed survey batch"}
      </h2>
      <p>
        {ubl?.name} ·{" "}
        {direct
          ? "Solar and BESS configurations may be mixed. Each site retains its own approved version and selling value."
          : "Request surveys for these sites. Design selects the solution family and approved configuration after the survey, during technical review."}
      </p>
      {!saved ? (
        <>
          {direct && (
            <div className="pz-form-grid">
              <Field id="batch-po-reference" label="Customer PO number">
                <input
                  id="batch-po-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
              <Field id="batch-po-date" label="Customer PO date">
                <input
                  id="batch-po-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field id="batch-po-total" label="Shared PO total including GST">
                <input
                  id="batch-po-total"
                  inputMode="decimal"
                  value={poTotal}
                  onChange={(e) => setPoTotal(e.target.value)}
                />
              </Field>
            </div>
          )}
          <Field
            id="batch-evidence"
            label={
              direct
                ? "Original shared PO attachment"
                : "Original survey request attachment"
            }
            hint="PDF, PNG or JPEG · up to 8 MB"
          >
            <FileUpload
              id="batch-evidence"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              selectedFiles={file ? [file] : []}
              onClear={() => setFile(undefined)}
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </Field>
          <div className="pz-table-scroll">
            <table
              className={
                "pz-configuration-batch" +
                (direct ? "" : " pz-configuration-batch--survey")
              }
            >
              <thead>
                <tr>
                  <th>SR#</th>
                  <th>Site</th>
                  <th>Branch code</th>
                  {direct && (
                    <>
                      <th>Approved configuration / version</th>
                      <th>Selling incl. GST</th>
                    </>
                  )}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const f = choices.find((f: any) => f.id === r.frameworkId);
                  return (
                    <tr key={r.key}>
                      <td>
                        <div className="pz-batch-primary">{i + 1}</div>
                      </td>
                      <td>
                        <Field
                          id={"batch-site-" + r.key}
                          label={"Site " + (i + 1) + " name"}
                        >
                          <input
                            id={"batch-site-" + r.key}
                            value={r.siteName}
                            onChange={(e) =>
                              change(r.key, "siteName", e.target.value)
                            }
                          />
                        </Field>
                        <Field
                          id={"batch-address-" + r.key}
                          label={"Site " + (i + 1) + " address"}
                        >
                          <input
                            id={"batch-address-" + r.key}
                            value={r.siteAddress}
                            onChange={(e) =>
                              change(r.key, "siteAddress", e.target.value)
                            }
                          />
                        </Field>
                      </td>
                      <td>
                        <Field
                          id={"batch-code-" + r.key}
                          label={"Site " + (i + 1) + " branch code"}
                        >
                          <input
                            id={"batch-code-" + r.key}
                            value={r.siteCode}
                            onChange={(e) =>
                              change(r.key, "siteCode", e.target.value)
                            }
                          />
                        </Field>
                      </td>
                      {direct && (
                        <>
                          <td>
                            <Field
                              id={"batch-config-" + r.key}
                              label={"Site " + (i + 1) + " configuration"}
                            >
                              <select
                                id={"batch-config-" + r.key}
                                value={r.frameworkId}
                                onChange={(e) =>
                                  change(r.key, "frameworkId", e.target.value)
                                }
                              >
                                <option value="">
                                  Select approved configuration
                                </option>
                                {choices.map((f: any) => (
                                  <option key={f.id} value={f.id}>
                                    {f.label ?? f.configuration_key} · v
                                    {f.version}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </td>
                          <td className="numeric">
                            <div className="pz-batch-primary">
                              {f?.total_including_gst
                                ? money(f.total_including_gst)
                                : "Select configuration"}
                            </div>
                          </td>
                        </>
                      )}
                      <td>
                        <Button
                          variant="neutral"
                          disabled={rows.length === 1 || busy}
                          aria-label={"Remove site " + (i + 1)}
                          onClick={() =>
                            setRows((old) => old.filter((v) => v.key !== r.key))
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pz-action-row">
            <Button
              variant="secondary"
              disabled={busy || rows.length >= 50}
              onClick={() => setRows((old) => [...old, empty()])}
            >
              Add site
            </Button>
            <span>
              {rows.length} sites
              {direct
                ? ` · Total including GST: ${money(total.toString())}`
                : " · Configuration selected during technical review"}
            </span>
          </div>
          <Field id="batch-notes" label="Original request / notes">
            <textarea
              id="batch-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <p className="pz-caption">
            Existing branch codes reuse their saved customer/site records.
            Verify the saved site names in the next step.
          </p>
          <div className="pz-action-row">
            <Button
              variant="primary"
              disabled={busy}
              loading={busy}
              onClick={() => void save()}
            >
              {direct ? "Prepare batch for review" : "Create survey batch"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {(saved.confirmed || !direct) && (
            <div className="pz-action-row">
              <Button
                variant="neutral"
                onClick={() => {
                  sessionStorage.removeItem(cacheKey);
                  setSaved(undefined);
                  setRows([empty()]);
                  setDocument(undefined);
                  createKey.current = crypto.randomUUID();
                  confirmKey.current = crypto.randomUUID();
                }}
              >
                Start another batch
              </Button>
            </div>
          )}
          <h3>
            {saved.confirmed
              ? "Batch issued"
              : direct
                ? "Review the saved batch"
                : "Survey requests created"}
          </h3>
          <p>
            {saved.records.length} sites
            {direct
              ? ` · Total including GST: ${money(saved.snapshot.total)} · PO ${saved.snapshot.po.reference}`
              : " · Configuration selected per site during technical review"}
          </p>
          {direct && !saved.confirmed && <div className="pz-form-grid">
            <IpoInvoiceTermsField id="batch-invoice-terms" label="Batch invoice terms" value={batchTerms} required={false}
              placeholder="Use programme defaults by site" disabled={busy}
              onChange={value => {setBatchTerms(value); setReviewed(false); setError("");}}/>
          </div>}
          <div className="pz-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>SR#</th>
                  <th>Site</th>
                  {direct && (
                    <>
                      <th>Configuration</th>
                      <th>Selling incl. GST</th>
                      {!saved.confirmed && <th>Invoice terms</th>}
                    </>
                  )}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {saved.records.map((r: any, i: number) => {
                  const doc = saved.previews?.find(
                    (d: any) => d.recordId === r.id,
                  );
                  return (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>
                        {r.siteName}
                        <div className="pz-caption">{r.siteCode}</div>
                      </td>
                      {direct && (
                        <>
                          <td>
                            {r.framework.key}
                            <div className="pz-caption">
                              Version {r.framework.version}
                            </div>
                          </td>
                          <td className="numeric">
                            {money(r.comparison.total)}
                          </td>
                          {!saved.confirmed && <td>
                            <IpoInvoiceTermsField id={"batch-site-terms-" + r.id} label={"Invoice terms for " + r.siteName}
                              value={siteTerms[r.id] ?? ""} required={false} disabled={busy}
                              placeholder={termsFor(r) ? "Use " + ipoInvoiceTermsLabels[termsFor(r) as IpoInvoiceTerms] : "Select when to invoice"}
                              onChange={value => {setSiteTerms(previous => ({...previous, [r.id]: value})); setReviewed(false); setError("");}}/>
                          </td>}
                        </>
                      )}
                      <td>
                        <div className="pz-action-row">
                          <Button
                            variant="secondary"
                            onClick={() => onOpen(r.id)}
                          >
                            Open site
                          </Button>
                          {doc && (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setDocument({
                                    title: r.siteName + " · Draft IPO",
                                    data: pdf(doc.ipo),
                                  })
                                }
                              >
                                Preview IPO
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setDocument({
                                    title: r.siteName + " · Detailed PT",
                                    data: pdf(doc.pt),
                                  })
                                }
                              >
                                Preview PT
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!direct && (
            <p>
              Open each request to verify its customer/site details and send to
              Design. Design uses the existing scheduling and dispatch process.
            </p>
          )}
          {direct && !saved.confirmed && (
            <>
              <div className="pz-action-row">
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => void preview()}
                >
                  Review IPO and PT documents
                </Button>
              </div>
              {saved.previews?.length > 0 && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{" "}
                    I reviewed every site's configuration, quantities and
                    selling value against the shared customer PO.
                  </label>
                  <div className="pz-action-row">
                    <Button
                      variant="primary"
                      disabled={!reviewed || busy}
                      loading={busy}
                      onClick={() => void confirm()}
                    >
                      Issue batch IPOs and PT
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      {document && (
        <section
          className="pz-panel pz-stack"
          aria-label="Batch document preview"
        >
          <div className="pz-action-row">
            <Button variant="neutral" onClick={() => setDocument(undefined)}>
              Close preview
            </Button>
          </div>
          <DocumentPreview url="" title={document.title} data={document.data} />
        </section>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
