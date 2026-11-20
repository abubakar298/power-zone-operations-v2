import { Action, Input, People } from "./parts.js";
import { workflowReferences } from "../../workspaces/workflow-list-reuse.js";
import { useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { NewCustomer } from "../../components/NewCustomer.js";
import { canWriteMaster } from "../../../server/masters/permissions.js";
import { routeNames } from "../../workspaces/project-routes.js";
import { confirmTransition } from "../../confirm.js";

export function CreateRecord({
  refs,
  session,
  creating,
  manager,
  onCreated,
  onCancel,
  onOpen,
  selectedSite,
  existingRequest,
  onEdited,
  onBatch,
}: any) {
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [customers, setCustomers] = useState(
    existingRequest?.masterReview.customer
      ? [
          existingRequest.masterReview.customer,
          ...refs.customers.filter(
            (c: any) => c.id !== existingRequest.masterReview.customer.id,
          ),
        ]
      : refs.customers,
  );
  const [addedCustomerId, setAddedCustomerId] = useState<string>();
  const [siteChoice, setSiteChoice] = useState(
    String(selectedSite?.id ?? "new"),
  );
  const [customer, setCustomer] = useState(
      String(selectedSite?.customer_id ?? ""),
    ),
    [route, setRoute] = useState(
      existingRequest
        ? existingRequest.record.route
        : creating === "Record PO / Customer Confirmation"
          ? "direct-framework"
          : creating.includes("Pre-agreed")
            ? "survey-framework"
            : creating === "Create BOQ"
              ? "quick-quote"
              : "survey-quote",
    );
  const availableSites = selectedSite
    ? [selectedSite, ...refs.sites.filter((s: any) => s.id !== selectedSite.id)]
    : refs.sites;
  const chosenSite = availableSites.find(
    (s: any) =>
      String(s.id) === siteChoice && String(s.customer_id) === customer,
  );
  const chosenCustomer = customers.find((c: any) => String(c.id) === customer);
  return (
    <>
      <Action
        title={
          route.startsWith("survey")
            ? "Review Survey Request"
            : "Create site workflow"
        }
        submitLabel={
          route.startsWith("survey") ? "Review Survey Request" : undefined
        }
        onSubmit={async (f) => {
          if (
            !customer ||
            !customers.some((c: any) => String(c.id) === customer)
          )
            throw new Error("Select a customer before submitting the request.");
          if (siteChoice === "existing")
            throw new Error("Select an existing site first.");
          const siteValues = [
            "siteName",
            "siteCode",
            "region",
            "siteAddress",
            "siteContact",
            "sitePhone",
          ].map((key) => String(f.get(key) ?? "").trim());
          const originalValues = chosenSite
            ? [
                chosenSite.name,
                chosenSite.code,
                chosenSite.region,
                chosenSite.location,
                chosenSite.contact_person,
                chosenSite.contact_phone,
              ].map((v) => String(v ?? "").trim())
            : [];
          const siteChanged =
            !!chosenSite &&
            JSON.stringify(siteValues) !== JSON.stringify(originalValues);
          if (
            siteChanged &&
            (!confirmTransition(
              "Update existing site?",
              "You edited the saved site details. Saving will update the master site and pass the revised details to Design.",
            ) ||
              !confirmTransition(
                "Confirm site changes again",
                "Confirm that these revised site details are correct and should be saved to this customer's existing site.",
              ))
          )
            throw new Error("Site changes were not saved.");
          const payload = {
            requestKey: crypto.randomUUID(),
            customerId: Number(customer),
            siteId:
              chosenSite?.customer_id === Number(customer)
                ? chosenSite.id
                : undefined,
            siteVersion: chosenSite?.version,
            confirmSiteChange: siteChanged,
            customerAddedHere: addedCustomerId === customer,
            siteName: f.get("siteName"),
            siteCode: f.get("siteCode"),
            region: f.get("region"),
            siteAddress: f.get("siteAddress"),
            siteContact: f.get("siteContact"),
            sitePhone: f.get("sitePhone"),
            route,
            frameworkId: f.get("frameworkId") || undefined,
            planningOwnerId: f.get("planningOwnerId") || undefined,
            coordinatorId: f.get("coordinatorId") || undefined,
            notes: f.get("notes"),
            headsup: creating === "Record Customer Heads-up",
          };
          if (onEdited) {
            await onEdited(payload);
            return;
          }
          const r = await api<any>("/project-workflow", {
            csrf: session.csrfToken,
            body: payload,
          });
          await onCreated(r.id);
        }}
      >
        <p>{creating}</p>
        {route.startsWith('survey')&&!onEdited&&<Button variant="secondary" onClick={onBatch}>Create pre-agreed survey batch</Button>}
        {creating === "Create BOQ" && (
          <Button
            variant="secondary"
            onClick={() => onOpen?.({ target: "boqs" })}
          >
            Open existing New / Revise BOQ form
          </Button>
        )}
        <div className="pz-form-grid">
          <label>
            Customer
            <select
              aria-label="Customer"
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                setSiteChoice("new");
              }}
              required
            >
              <option value="">Select customer</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.short_code} · {c.name}
                </option>
              ))}
            </select>
            {canWriteMaster(session.user.role, "customers", "new") && (
              <Button
                variant="secondary"
                onClick={() => setAddingCustomer(true)}
              >
                Add customer
              </Button>
            )}
          </label>
          <label>
            Workflow route
            <select aria-label="Workflow route" value={route} onChange={(e) => setRoute(e.target.value)}>
              {Object.entries(routeNames)
                .filter(
                  ([v]) =>
                    creating !== "Create survey request" ||
                    v.startsWith("survey-"),
                )
                .map(([v, n]) => (
                  <option key={v} value={v}>
                    {n as string}
                  </option>
                ))}
            </select>
          </label>
          {chosenCustomer && route.startsWith("survey") && (
            <dl className="pz-field-wide project-facts" aria-label="Saved customer details">
              {[
                ["Contact person", chosenCustomer.contact_person],
                ["Contact number", chosenCustomer.phone],
                ["Email", chosenCustomer.email],
                ["Billing address", chosenCustomer.address],
              ].map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value || "Not entered"}</dd></div>
              ))}
            </dl>
          )}
          <div
            className="pz-field-wide pz-action-row workspace-groups"
            role="group"
            aria-label="Site entry mode"
          >
            <Button
              aria-pressed={siteChoice === "new"}
              onClick={() => setSiteChoice("new")}
            >
              Create new site
            </Button>
            <Button
              aria-pressed={siteChoice !== "new"}
              onClick={() => setSiteChoice("existing")}
            >
              Choose existing site
            </Button>
          </div>
          {siteChoice !== "new" && (
            <label className="pz-field-wide">
              Existing site
              <select
                aria-label="Site selection"
                value={siteChoice}
                onChange={(e) => setSiteChoice(e.target.value)}
              >
                <option value="existing">Select existing site</option>
                {availableSites
                  .filter(
                    (s: any) =>
                      String(s.customer_id) === customer &&
                      s.status === "Active",
                  )
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <Input
            key={`name-${siteChoice}`}
            name="siteName"
            title="Site name"
            value={chosenSite?.name}
            required
          />
          <Input
            key={`code-${siteChoice}`}
            name="siteCode"
            title="Site / branch code"
            value={chosenSite?.code}
            required
          />
          <Input
            key={`region-${siteChoice}`}
            name="region"
            title="Region"
            value={chosenSite?.region}
          />
          <Input
            key={`address-${siteChoice}`}
            name="siteAddress"
            title="Site address"
            value={chosenSite?.location}
            required={!chosenSite}
          />
          <Input
            key={`contact-${siteChoice}`}
            name="siteContact"
            title="Site contact person"
            value={chosenSite?.contact_person}
          />
          <Input
            key={`phone-${siteChoice}`}
            name="sitePhone"
            title="Site contact number"
            value={chosenSite?.contact_phone}
          />
          {route === "direct-framework" && (
            <label>
              Approved configuration and price version
              <select aria-label="Approved configuration and price version" name="frameworkId" required>
                <option value="">Select approved agreement</option>
                {refs.frameworks
                  .filter(
                    (f: any) =>
                      f.customer_id === Number(customer) &&
                      f.routes?.includes(route),
                  )
                  .map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.configuration_key} · v{f.version}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {manager && (
            <People
              {...{ refs }}
              name="coordinatorId"
              title="Coordination owner"
              role="Coordinator"
            />
          )}
        </div>
        <label>
          Original request / notes
          <textarea
            name="notes"
            required
            defaultValue={existingRequest?.record.data.notes ?? ""}
          />
        </label>
        <Button onClick={onCancel}>Cancel</Button>
      </Action>
      {addingCustomer && (
        <NewCustomer
          session={session}
          context="survey request"
          onClose={() => setAddingCustomer(false)}
          onLogout={() => window.location.reload()}
          onCreated={async (id: string) => {
            const updated = await workflowReferences(session.user.id,{fresh:true});
            setCustomers(updated.customers);
            setCustomer(String(id));
            setAddedCustomerId(String(id));
            setSiteChoice("new");
          }}
        />
      )}
    </>
  );
}
