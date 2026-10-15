import {InventoryCatalogue} from '../components/InventoryCatalogue.js';
import { compareRateItems } from "../ui/rateOrder.js";
import {Button} from "../ui/Button.js";
import { CustomerImport } from "../components/CustomerImport.js";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";
import { canWriteMaster } from "../../server/masters/permissions.js";
type Kind = "customers" | "sites" | "brands" | "rates" | "rules" | "items";
type Row = Record<string, string | number | null>;
type Data = Record<Kind, Row[]> & {
  inverters: Row[];
  classifications: Row[];
  imports: Row[];
};
const titles: Record<Kind, string> = {
  customers: "Customers",
  sites: "Sites",
  brands: "Brands",
  rates: "Rates",
  rules: "Engineering rules",
  items: "Items & specifications",
};
const columns: Record<Kind, [string, string][]> = {
  customers: [
    ["id", "ID"],
    ["name", "Customer"],
    ["short_code", "Short code"],
    ["contact_person", "Contact"],
    ["phone", "Phone"],
    ["city", "City"],
    ["province", "Province"],
    ["status", "Status"],
  ],
  sites: [
    ["id", "ID"],
    ["customer_name", "Customer"],
    ["name", "Site"],
    ["code", "Site code"],
    ["location", "Location"],
    ["status", "Status"],
  ],
  brands: [
    ["category", "Category"],
    ["name", "Brand"],
    ["status", "Status"],
    ["notes", "Notes"],
  ],
  rates: [
    ["pt_item_ids", "PT Item IDs"],
    ["key", "Rate source / historical name"],
    ["unit", "UOM"],
    ["rate", "Rate (PKR)"],
    ["status", "Status"],
    ["version", "Version"],
    ["notes", "Review notes / allowance basis"],
  ],
  rules: [
    ["rule_group", "Group"],
    ["setting", "Setting"],
    ["value", "Value"],
    ["version", "Version"],
  ],
  items: [
    ["display_name", "Item"],
    ["item_group", "Group"],
    ["unit", "UOM"],
    ["approved_specification", "Approved technical specification"],
    ["status", "Status"],
  ],
};
const fields: Record<Kind, string[]> = {
  customers: [
    "name",
    "short_code",
    "contact_person",
    "phone",
    "email",
    "address",
    "city",
    "province",
    "status",
    "notes",
  ],
  sites: ["name", "code", "location", "status"],
  brands: ["status", "notes"],
  rates: ["rate", "status", "notes"],
  rules: ["value", "notes"],
  items: ["approved_specification", "status", "notes"],
};
const labels: Record<string, string> = {
  name: "Name",
  short_code: "Short code",
  contact_person: "Contact person",
  phone: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  province: "Province",
  status: "Status",
  notes: "Notes",
  code: "Site code",
  location: "Location",
  rate: "Rate (PKR)",
  value: "Value",
  approved_specification: "Technical specification",
};
const numberFormat = new Intl.NumberFormat("en-PK", {
  maximumFractionDigits: 4,
});
export function Masters({
  session,
  onLogout, initialKind="customers", allowedKinds, onOpenUbl,
}: {
  initialKind?: Kind; allowedKinds?: Kind[]; onOpenUbl?:()=>void;
  session: Session;
  onLogout: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [catalogueOpen,setCatalogueOpen]=useState(false),
    [kind, setKind] = useState<Kind>(initialKind),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{
    kind: Kind;
    row: Row;
    isNew?: boolean;
  } | null>(null);
  const [history, setHistory] = useState<Row[] | null>(null);
  async function load() {
    try {
      setData(await api<Data>("/masters"));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError(e instanceof Error ? e.message : "Unable to load masters.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        setEdit(null);
        setHistory(null);
      }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit || busy) return;
    const form = new FormData(e.currentTarget);
    const values: Record<string, unknown> = {};
    for (const field of fields[edit.kind]) {
      const value = String(form.get(field) ?? "");
      values[field] = field === "rate" && value === "" ? null : value;
    }
    const customerCorrection=edit.kind==='customers'&&!edit.isNew&&session.user.role==='Coordinator';
    const changeReason=String(form.get('changeReason')??'').trim();
    if(customerCorrection){
      values.short_code=edit.row.short_code;values.status=edit.row.status;
      if(!changeReason){setError('Enter a reason for the customer update.');return;}
      if(!window.confirm(`Update ${edit.row.name}?\nReason: ${changeReason}\nHistorical documents keep their saved customer details.`)||!window.confirm('Confirm saving these customer details to the database?'))return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/masters/${edit.kind}`, {
        body: {
          id: edit.isNew ? "new" : String(edit.row.id ?? edit.row.key),
          version: Number(edit.row.version ?? 0),
          values,
          ...(customerCorrection?{changeReason}:{}),
        },
        csrf: session.csrfToken,
      });
      setEdit(null);
      setMessage("Saved. Your master data is up to date.");
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(row: Row) {
    setError("");
    try {
      const r = await api<{ versions: Row[] }>(
        `/masters/${kind}/history?key=${encodeURIComponent(String(row.key))}`,
      );
      setHistory(r.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load history.");
    }
  }
  function display(row: Row, key: string) {
    const reviewReasons: Record<string, string> = {
      "SP AC Conduit Accessories and Box": "Temporary PKR 5,000 allowance: AC box, conduit and termination accessories. Confirm actual combined cost.",
      "500V 2P DC Breaker": "Confirm supplier rate and current rating; the current rate column is authoritative.",
      "SP DC Enclosures": "Temporary PKR 5,000 project allowance for roof and inverter-room DC enclosures. Confirm actual cost.",
    };
    if (kind === "rates" && key === "notes" && rateReview(row) && reviewReasons[String(row.key)]) return reviewReasons[String(row.key)] + " " + String(row.notes ?? "");
    const value = row[key];
    if (value === null || value === "") return "—";
    return ["rate", "value", "version", "id"].includes(key)
      ? numberFormat.format(Number(value))
      : String(value);
  }
  const rateReview = (r: Row) => r.status === "Needs Rate" || /provisional|temporary|review later/i.test(String(r.notes ?? "")) && ["SP AC Conduit Accessories and Box", "SP DC Enclosures", "500V 2P DC Breaker", "63A 4P Changeover"].includes(String(r.key));
  const rows = (data?.[kind] ?? [])
    .filter((r) => filter === "All" || (filter === "Under review" ? rateReview(r) : String(r.status) === filter))
    .filter((r) =>
      columns[kind].some(([key]) =>
        String(r[key] ?? "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    );
  if (kind === "rates") rows.sort((a, b) => compareRateItems(String(a.key), String(b.key)));
  return (
    <section className="masters" aria-label="Master data">
      <div
        className="master-tabs"
        role="tablist"
        aria-label="Master data sections"
      >
        {(allowedKinds ?? Object.keys(titles) as Kind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? "selected" : ""}
            onClick={() => {
              setCatalogueOpen(false);
              setKind(k);
              setQuery("");
              setFilter("All");
              setMessage("");
            }}
          >
            {titles[k]} <span>{data?.[k].length ?? "…"}</span>
          </button>
        ))}
      </div>
      {data && <Button variant="secondary" onClick={()=>setCatalogueOpen(!catalogueOpen)}>{catalogueOpen?"Back to master records":"PT Item catalogue & approved rules"}</Button>}
      {catalogueOpen && data ? <InventoryCatalogue data={data}/> : <>
      <div className="master-toolbar">
        <div>
          <h2>{titles[kind]}</h2>
          <p>
            {kind === "rates"
              ? "Buying rates and their supplied statuses. Needs Rate may still carry a numeric rate."
              : kind === "rules"
                ? "Approved engineering settings. Changes create a new version."
                : kind === "items"
                  ? "Supplied technical data and missing specifications. Items needing review do not override the design rules."
                  : kind === "sites"
                    ? "Site codes are text; leading zeros are preserved. New sites will be created in New BOQ."
                    : "Reference records imported from your workbook."}
          </p>
        </div>
        {kind === "customers" &&
          canWriteMaster(session.user.role, "customers", "new") && (
            <button
              className="dark-button"
              onClick={() => {
                setError("");
                setEdit({
                  kind: "customers",
                  row: { status: "Active" },
                  isNew: true,
                });
              }}
            >
              Add customer
            </button>
          )}
      </div>
      {kind === "customers" && session.user.role === "Admin" && (
        <CustomerImport session={session} onImported={load} />
      )}
      <label className="search-label" htmlFor="master-search">
        Search {titles[kind].toLowerCase()}
      </label>
      <input
        id="master-search"
        className="master-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${titles[kind].toLowerCase()}…`}
      />
      {kind === "rates" && <label className="master-filter">Rate review status<select value={filter} onChange={e => setFilter(e.target.value)}><option>All</option><option>Under review</option><option>Active</option><option>Needs Rate</option></select><small>Temporary allowances are usable for costing but need confirmation. Edit the rate and notes after review.</small></label>}
      {kind === "items" && (
        <label className="master-filter">
          Specification status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option>All</option>
            <option>Need to enter</option>
            <option>Needs review</option>
            <option>Approved</option>
          </select>
        </label>
      )}
      {error && !edit && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p role="status">Loading master data…</p>
      ) : (
        <>
          <p className="master-count">
            {numberFormat.format(rows.length)} of{" "}
            {numberFormat.format(data[kind].length)} records ·{" "}
            {session.user.role === "Admin"
              ? "Administrator editing enabled"
              : canWriteMaster(
                    session.user.role,
                    kind,
                    kind === "customers" ? "new" : "existing",
                  )
                ? kind === "customers"
                  ? "Customer creation enabled"
                  : "Editing enabled"
                : "Read-only access"}
          </p>
          <div className="master-table-wrap">
            <table className="master-table">
              <thead>
                <tr>
                  {columns[kind].map(([key, label]) => (
                    <th
                      key={key}
                      className={
                        ["rate", "value", "version", "id"].includes(key)
                          ? "numeric"
                          : ""
                      }
                    >
                      {label}
                    </th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={String(row.id ?? row.key ?? i)}>
                    {columns[kind].map(([key]) => (
                      <td
                        key={key}
                        className={
                          ["rate", "value", "version", "id"].includes(key)
                            ? "numeric"
                            : ""
                        }
                      >
                        {key === "status" ? (
                          <span
                            className={`master-status ${row.status === "Needs Rate" ? "needs-rate" : ""}`}
                          >
                            {kind === "rates" && rateReview(row) ? "Under review" : display(row, key)}
                          </span>
                        ) : (
                          display(row, key)
                        )}
                      </td>
                    ))}
                    {
                      <td className="master-actions">
                        {kind==="customers"&&row.short_code==="UBL"&&onOpenUbl&&<Button variant="secondary" onClick={onOpenUbl}>UBL configurations</Button>}
                        {canWriteMaster(
                          session.user.role,
                          kind,
                          String(row.id ?? row.key),
                        ) && (
                          <button
                            aria-label={`Edit ${row.name ?? row.key ?? row.setting}`}
                            onClick={() => {
                              setError("");
                              setEdit({ kind, row });
                            }}
                          >
                            Edit
                          </button>
                        )}
                        {(kind === "rates" ||
                          kind === "rules" ||
                          kind === "items") && (
                          <button
                            aria-label={`History ${row.key}`}
                            onClick={() => {
                              void showHistory(row);
                            }}
                          >
                            History
                          </button>
                        )}
                      </td>
                    }
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="empty-state">No matching records.</p>
            )}
          </div>
          {kind === "rules" && (
            <section className="master-mapping">
              <h3>Inverter configurations</h3>
              <div className="master-table-wrap">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Configuration</th>
                      <th className="numeric">Total kW</th>
                      <th>SKU</th>
                      <th className="numeric">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inverters.map((r) => (
                      <tr key={String(r.configuration)}>
                        <td>{r.configuration}</td>
                        <td className="numeric">
                          {numberFormat.format(Number(r.total_kw))}
                        </td>
                        <td>{r.sku}</td>
                        <td className="numeric">{r.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Costing classification reference</h3>
              <div className="master-table-wrap">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Phase</th>
                      <th>EPC category</th>
                      <th>Item / rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.classifications.map((r) => (
                      <tr key={String(r.item_rule)}>
                        <td>{r.phase}</td>
                        <td>{r.epc_category || "—"}</td>
                        <td>{r.item_rule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="master-provenance">
            Imported from your reviewed reference workbook. Master changes do
            not alter saved BOQ or quotation snapshots.
          </p>
        </>
      )}
      {edit && (
        <div className="modal-backdrop">
          <section
            className="master-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-master-title"
          >
            <h2 id="edit-master-title">
              {edit.isNew
                ? "Add customer"
                : `Edit ${titles[edit.kind].toLowerCase()}`}
            </h2>
            {!edit.isNew && (
              <p>
                {edit.row.display_name ??
                  edit.row.name ??
                  edit.row.key ??
                  edit.row.setting}{" "}
                · Version {edit.row.version}
              </p>
            )}
            <form onSubmit={save}>
              {fields[edit.kind].map((field, i) => (
                <label key={field}>
                  {labels[field]}
                  {edit.kind==='customers'&&!edit.isNew&&session.user.role==='Coordinator'&&['short_code','status'].includes(field)?<input name={field} value={String(edit.row[field]??'')} readOnly/>:field === "status" ? (
                    <select
                      aria-label={labels[field]}
                      name={field}
                      defaultValue={String(edit.row[field] ?? "Active")}
                    >
                      {edit.kind === "items" ? (
                        <>
                          <option>Need to enter</option>
                          <option>Needs review</option>
                          <option>Approved</option>
                        </>
                      ) : (
                        <>
                          <option>Active</option>
                          {edit.kind === "rates" && <option>Needs Rate</option>}
                          <option>Inactive</option>
                        </>
                      )}
                    </select>
                  ) : field === "notes" ||
                    field === "address" ||
                    field === "approved_specification" ? (
                    <textarea
                      name={field}
                      defaultValue={String(edit.row[field] ?? "")}
                      maxLength={2000}
                    />
                  ) : (
                    <input
                      name={field}
                      defaultValue={String(edit.row[field] ?? "")}
                      autoFocus={i === 0}
                      inputMode={
                        field === "rate" || field === "value"
                          ? "decimal"
                          : undefined
                      }
                      type={field === "email" ? "email" : "text"}
                      maxLength={
                        field === "short_code" || field === "code"
                          ? 30
                          : field === "phone"
                            ? 100
                            : field === "email"
                              ? 254
                              : 200
                      }
                      required={[
                        "name",
                        "short_code",
                        "code",
                        "value",
                      ].includes(field)}
                    />
                  )}
                </label>
              ))}
              {edit.kind==='customers'&&!edit.isNew&&session.user.role==='Coordinator'&&<label>Reason for change<textarea name="changeReason" maxLength={2000} required/></label>}
              {(edit.kind === "rates" ||
                edit.kind === "rules" ||
                edit.kind === "items") && (
                <p className="form-note">
                  Saving creates a new version. Earlier values remain unchanged.
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEdit(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button className="dark-button" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {history && (
        <div className="modal-backdrop">
          <section
            className="master-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-history-title"
          >
            <h2 id="master-history-title">Version history</h2>
            <p>{history[0]?.key}</p>
            <table className="master-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th className="numeric">Value</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={Number(r.version)}>
                    <td>{r.version}</td>
                    <td className="numeric">
                      {r.specification !== undefined
                        ? String(r.specification ?? "—")
                        : display(r, r.rate !== undefined ? "rate" : "value")}
                    </td>
                    <td>{r.status ?? "—"}</td>
                    <td>
                      {new Date(String(r.created_at)).toLocaleDateString(
                        "en-PK",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="dark-button"
              autoFocus
              onClick={() => setHistory(null)}
            >
              Close history
            </button>
          </section>
        </div>
      )}
      </>}
    </section>
  );
}

