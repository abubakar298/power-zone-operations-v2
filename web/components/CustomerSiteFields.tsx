import { useEffect, useState } from "react";
import { recommendSiteCode } from "../../server/boq/schema.js";

/** A customer ID is submitted only after an explicit selection from the search results. */
export function CustomerSiteFields({
  masters,
  initial,
  revision,
  preferredCustomer,
  onAdd,
}: {
  masters: any;
  initial: any;
  revision: boolean;
  preferredCustomer?: string;
  onAdd?: () => void;
}) {
  const [customer, setCustomer] = useState(String(initial.customerId ?? ""));
  const [customerSearch, setCustomerSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const [siteId, setSiteId] = useState("");
  const [site, setSite] = useState({
    name: initial.siteName ?? "",
    code: initial.siteCode ?? "",
    location: initial.location ?? "",
  });
  useEffect(() => {
    setCustomer(String(initial.customerId ?? ""));
    setSite({
      name: initial.siteName ?? "",
      code: initial.siteCode ?? "",
      location: initial.location ?? "",
    });
    setCustomerSearch("");
    setSearchOpen(false);
    setSiteId("");
  }, [initial]);
  useEffect(() => {
    if (preferredCustomer) {
      setCustomer(preferredCustomer);
      setCustomerSearch("");
      setSearchOpen(false);
      setSiteId("");
    }
  }, [preferredCustomer]);
  const sites = (masters.sites as any[]).filter(
    (s: any) => s.status === "Active" && String(s.customer_id) === customer,
  );
  const changeCustomer = (value: string) => {
    setCustomer(value);
    setSiteId("");

    setSite({ name: "", code: "", location: "" });
  };
  return (
    <>
      <div className="customer-field">
      <label>
        Customer
        <input type="search" role="combobox" aria-label="Customer" aria-expanded={searchOpen && !revision} aria-controls="boq-customer-options" aria-autocomplete="list" required disabled={revision}
          value={customerSearch || (masters.customers.find((c: any) => String(c.id) === customer)?.name ?? "")}
          placeholder="Search customer name, code or contact"
          onFocus={() => setSearchOpen(true)}
          ref={input => { input?.setCustomValidity(customer || revision ? "" : "Select a customer from the search results."); }}
          onChange={e => { setCustomerSearch(e.target.value); changeCustomer(""); setSearchOpen(true); }}
          onKeyDown={e => {
            if (e.key === "Escape") setSearchOpen(false);
            if (e.key === "ArrowDown") { e.preventDefault(); setSearchOpen(true); document.querySelector<HTMLButtonElement>("#boq-customer-options button")?.focus(); }
            if (e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLButtonElement>("#boq-customer-options button")?.click(); }
          }} />
        <input type="hidden" name="customerId" value={customer} />
        {!revision && searchOpen && <div className="customer-search-results" id="boq-customer-options" role="listbox" aria-label="Customer matches">
          {masters.customers.filter((c: any) => c.status === "Active" && [c.name,c.short_code,c.contact_person,c.phone].join(" ").toLowerCase().includes(customerSearch.trim().toLowerCase())).map((c: any) =>
            <button key={c.id} type="button" role="option" aria-selected={String(c.id) === customer} onKeyDown={e => { const target = e.currentTarget; if (e.key === "ArrowDown") { e.preventDefault(); (target.nextElementSibling as HTMLElement)?.focus(); } if (e.key === "ArrowUp") { e.preventDefault(); (target.previousElementSibling as HTMLElement)?.focus(); } if (e.key === "Escape") setSearchOpen(false); }} onClick={() => { changeCustomer(String(c.id)); setCustomerSearch(""); setSearchOpen(false); }}>{c.name} · {c.short_code}</button>)}
        </div>}
      </label>
      {onAdd && !revision && <button type="button" onClick={() => { setSearchOpen(false); onAdd(); }}>Add customer</button>}
      </div>
      <label>
        {siteId || revision ? "Site name" : "New site name"}
        <input
          name="siteName"
          aria-label="New site name"
          value={site.name}
          readOnly={revision}
          required
          maxLength={200}
          list={revision ? undefined : "boq-site-options"}
          onChange={(e) => {
            const existing = sites.find((s: any) => s.name === e.target.value);
            setSiteId(existing ? String(existing.id) : "");
            setSite(existing ? {name: existing.name, code: existing.code, location: existing.location ?? ""} : {...site, name: e.target.value, code: ""});
          }}
          onBlur={() => {
            if (!site.code)
              setSite({ ...site, code: recommendSiteCode(site.name) });
          }}
        />
      </label>
      {!revision && <datalist id="boq-site-options">{sites.map((s: any) => <option key={s.id} value={s.name}>{s.code}</option>)}</datalist>}
      <label>
        Site code
        <input
          name="siteCode"
          aria-label="Site code"
          value={site.code}
          readOnly={revision || !!siteId}
          required
          maxLength={30}
          pattern="[A-Za-z0-9_-]+"
          onChange={(e) => setSite({ ...site, code: e.target.value })}
        />
        <small>
          Suggested from the site name; you can edit it. Leading zeros are
          preserved.
        </small>
      </label>
      <label>
        Location
        <input
          name="location"
          aria-label="Location"
          value={site.location}
          readOnly={revision}
          maxLength={1000}
          onChange={(e) => setSite({ ...site, location: e.target.value })}
        />
      </label>
    </>
  );
}
