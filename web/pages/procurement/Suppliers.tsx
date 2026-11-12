import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { PagedTableBody } from "../../ui/PagedTableBody.js";

export interface Supplier { id: string; name: string; email: string; phone: string }
type SupplierInput = Omit<Supplier, "id">;
const blank = { name: "", email: "", phone: "" };

function readSupplierCsv(source: string): SupplierInput[] {
  const records: string[][] = [];
  let row: string[] = [], value = "", quoted = false, closed = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(value.trim());
      value = "";
      closed = false;
      if (char !== ",") {
        if (row.some(Boolean)) records.push(row);
        row = [];
        if (char === "\r" && source[i + 1] === "\n") i++;
      }
    } else if (char === '"' && !value && !closed) quoted = true;
    else if (char === '"' || closed) throw new Error("Check the quotation marks in the CSV.");
    else value += char;
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted value.");
  row.push(value.trim());
  if (row.some(Boolean)) records.push(row);
  const headers = records.shift()?.map(value => value.toLowerCase());
  const name = headers?.indexOf("name") ?? -1;
  if (name < 0 || !headers || !records.length || records.length > 500) {
    throw new Error("Upload a CSV with a name column and between 1 and 500 suppliers.");
  }
  const email = headers.indexOf("email"), phone = headers.indexOf("phone");
  return records.map((record, index) => {
    if (record.length !== headers.length || !record[name]) throw new Error(`Check the supplier details on CSV row ${index + 2}.`);
    return { name: record[name], email: record[email] ?? "", phone: record[phone] ?? "" };
  });
}

export function ProcurementSuppliers({ session }: { session: Session }) {
  const [rows, setRows] = useState<Supplier[]>();
  const [entry, setEntry] = useState(blank);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setRows((await api<{ suppliers: Supplier[] }>("/procurement/suppliers")).suppliers); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to load suppliers."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(suppliers: SupplierInput[]) {
    if (pending) return false;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ added: number; duplicates: number }>("/procurement/suppliers", {
        csrf: session.csrfToken, body: { suppliers },
      });
      await load();
      setMessage(`${result.added} added. ${result.duplicates} duplicates skipped.`);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save suppliers.");
      return false;
    } finally { setPending(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("suppliers-csv") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { setError("Choose a CSV smaller than 1 MB."); return; }
    try { if (await save(readSupplierCsv((await file.text()).replace(/^\uFEFF/, "")))) input.value = ""; }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to read the CSV."); }
  }

  return <section className="pz-panel pz-stack">
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <h3>Add supplier</h3>
    <form className="pz-stack" onSubmit={event => { event.preventDefault(); void save([entry]).then(ok => { if (ok) setEntry(blank); }); }}>
      <div className="pz-form-grid">
        {([["name", "Supplier name (required)", "text"], ["email", "Email", "email"], ["phone", "Phone", "tel"]] as const).map(([key, label, type]) =>
          <Field key={key} id={`supplier-${key}`} label={label}>
            <input id={`supplier-${key}`} type={type} value={entry[key]} required={key === "name"} maxLength={key === "phone" ? 100 : 200}
              onChange={event => setEntry(previous => ({ ...previous, [key]: event.target.value }))} />
          </Field>)}
      </div>
      <div><Button variant="primary" type="submit" loading={pending}>Add supplier</Button></div>
    </form>
    <h3>Import supplier CSV</h3>
    <form className="pz-stack" onSubmit={event => void upload(event)}>
      <Field id="suppliers-csv" label="Supplier CSV" hint="Use columns name, email and phone. Only name is required.">
        <input id="suppliers-csv" name="suppliers-csv" type="file" accept=".csv,text/csv" required aria-describedby="suppliers-csv-hint" />
      </Field>
      <div><Button variant="secondary" type="submit" loading={pending}>Import suppliers</Button></div>
    </form>
    <h3>Supplier directory</h3>
    {!rows && !error && <p role="status">Loading suppliers…</p>}
    {rows?.length === 0 && <p>No suppliers have been added.</p>}
    {rows && rows.length > 0 && <div className="pz-table-scroll"><table className="ops-table">
      <thead><tr><th>SR#</th><th>Supplier</th><th>Email</th><th>Phone</th></tr></thead>
      <PagedTableBody label="suppliers">{rows.map((row, i) => <tr key={row.id}>
        <td>{i + 1}</td><td><strong>{row.name}</strong></td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td>
      </tr>)}</PagedTableBody>
    </table></div>}
  </section>;
}
