import { useEffect, useState } from "react";
import { recommendSiteCode } from "../../server/boq/schema.js";

/** Search does not change a selected identity; choosing another customer does. */
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
  const [siteSearch, setSiteSearch] = useState("");
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
    setSiteSearch("");
    setSiteId("");
  }, [initial]);
  useEffect(() => {
    if (preferredCustomer) {
      setCustomer(preferredCustomer);
      setCustomerSearch("");
      setSiteSearch("");
      setSiteId("");
    }
  }, [preferredCustomer]);
  const sites = masters.sites.filter(
    (s: any) => s.status === "Active" && String(s.customer_id) === customer,
  );
  const changeCustomer = (value: string) => {
    setCustomer(value);
    setSiteId("");
    setSiteSearch("");
    setSite({ name: "", code: "", location: "" });
  };
  return (
    <>
      {!revision && (
        <label>
          Find customer
          <input
            type="search"
            aria-label="Find BOQ customer"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Search by name, code or contact"
          />
        </label>
      )}
      <label>
        Customer
        <select
          name="customerId"
          aria-label="Customer"
          disabled={revision}
          value={customer}
          required
          onChange={(e) => changeCustomer(e.target.value)}
        >
          <option value="">Select customer</option>
          {masters.customers
            .filter(
              (c: any) =>
                c.status === "Active" &&
                (String(c.id) === customer ||
                  [c.name, c.short_code, c.contact_person, c.phone]
                    .join(" ")
                    .toLowerCase()
                    .includes(customerSearch.trim().toLowerCase())),
            )
            .map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.short_code}
              </option>
            ))}
        </select>
        {onAdd && !revision && (
          <button type="button" onClick={onAdd}>
            Add customer
          </button>
        )}
      </label>
      {!revision && (
        <>
          <label>
            Find site
            <input
              type="search"
              aria-label="Find BOQ site"
              disabled={!customer}
              value={siteSearch}
              onChange={(e) => setSiteSearch(e.target.value)}
              placeholder="Search this customer's sites"
            />
          </label>
          <label>
            Existing site
            <select
              aria-label="Existing site"
              disabled={!customer}
              value={siteId}
              onChange={(e) => {
                const chosen = sites.find(
                  (s: any) => String(s.id) === e.target.value,
                );
                setSiteId(e.target.value);
                setSite(
                  chosen
                    ? {
                        name: chosen.name,
                        code: chosen.code,
                        location: chosen.location ?? "",
                      }
                    : { name: "", code: "", location: "" },
                );
              }}
            >
              <option value="">Create a new site</option>
              {sites
                .filter(
                  (s: any) =>
                    String(s.id) === siteId ||
                    [s.name, s.code, s.location]
                      .join(" ")
                      .toLowerCase()
                      .includes(siteSearch.trim().toLowerCase()),
                )
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.code}
                  </option>
                ))}
            </select>
            <small>
              If this site already has a BOQ, open that BOQ and create a
              revision.
            </small>
          </label>
        </>
      )}
      <label>
        {siteId || revision ? "Site name" : "New site name"}
        <input
          name="siteName"
          aria-label="New site name"
          value={site.name}
          readOnly={!!siteId}
          required
          maxLength={200}
          onChange={(e) => setSite({ ...site, name: e.target.value })}
          onBlur={() => {
            if (!site.code)
              setSite({ ...site, code: recommendSiteCode(site.name) });
          }}
        />
      </label>
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
          readOnly={!!siteId}
          maxLength={1000}
          onChange={(e) => setSite({ ...site, location: e.target.value })}
        />
      </label>
    </>
  );
}
