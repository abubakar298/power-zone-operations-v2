import { ErrorText, Action, Input } from "./parts.js";
import { recentFirst } from "../../../shared/recent-records.js";
import { PagedTableBody } from "../../ui/PagedTableBody.js";
import { confirmLeaveWorkspace } from "../../hooks/useUnsavedChanges.js";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { DocumentPreview } from "../../components/DocumentPreview.js";

export function DispatchPdfReview({
  session,
  plan,
  onBack,
  onScheduled,
  canApprove = false,
}: any) {
  const frame = useRef<HTMLDivElement>(null);
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewOpened, setPreviewOpened] = useState(false);
  const kind = "dispatch";
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/project-workflow/survey-dispatch-previews/${plan.id}/pdf?kind=${kind}`;
  return (
    <div className="pz-stack">
      <Button variant="neutral" onClick={onBack}>
        Back
      </Button>
      <section className="pz-panel">
        <h2>
          {plan.number} · {plan.sites.length} site
          {plan.sites.length === 1 ? "" : "s"}
        </h2>
        <p>
          Scheduled date: {plan.date} · Surveyors:{" "}
          {plan.surveyors.map((person: any) => person.display_name).join(", ")}
        </p>
        <p>
          {plan.closed
            ? "Dispatch closed"
            : plan.approved
              ? "Dispatch approved and assigned"
              : "Dispatch preview only — schedules are already saved; dispatch has not been assigned."}
        </p>
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Customer / site</th>
                <th>Address</th>
                <th>Site contact</th>
              </tr>
            </thead>
            <PagedTableBody label="sites and documents">
              {plan.sites.map((site: any) => (
                <tr key={site.recordId}>
                  <td>
                    {site.customerCode} · {site.site} ({site.code})
                  </td>
                  <td>{site.address || "Not entered"}</td>
                  <td>
                    {site.contact || "Not entered"} ·{" "}
                    {site.phone || "Not entered"}
                  </td>
                </tr>
              ))}
            </PagedTableBody>
          </table>
        </div>
      </section>
      <Button
        variant="secondary"
        aria-expanded={previewOpen}
        aria-pressed={previewOpen}
        aria-controls={`dispatch-preview-${plan.id}`}
        onClick={() => {
          setPreviewOpen(!previewOpen);
          setPreviewOpened(true);
        }}
      >
        Preview Dispatch
      </Button>
      {previewOpened && (
        <div
          id={`dispatch-preview-${plan.id}`}
          ref={frame}
          hidden={!previewOpen}
        >
          <DocumentPreview
            url={url}
            title={`${plan.number} - Survey Dispatch Order`}
            onReady={() => setDocumentLoaded(true)}
          />
        </div>
      )}
      <label className="pz-review-check">
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />
        I have reviewed the sites, surveyors, date and document preview.
      </label>
      <div className="pz-action-row">
        <Button
          variant="secondary"
          disabled={!verified || !documentLoaded}
          onClick={() => {
            const images = Array.from(
              frame.current?.querySelectorAll<HTMLImageElement>(
                ".ipo-preview-pages img",
              ) ?? [],
            );
            const printWindow = window.open("", "_blank");
            if (!printWindow || !images.length) {
              setError(
                "Allow the print window, or download the reviewed PDF to print it.",
              );
              return;
            }
            printWindow.document.write(
              "<!doctype html><html><head><title>Survey Dispatch</title><style>@page{size:A4;margin:0}body{margin:0}img{display:block;width:210mm;height:auto;break-after:page}img:last-child{break-after:auto}</style></head><body>" +
                images
                  .map(
                    (image) =>
                      `<img src="${image.src}" alt="Survey document page">`,
                  )
                  .join("") +
                "</body></html>",
            );
            printWindow.document.close();
            Promise.all(
              Array.from(printWindow.document.images).map((image) =>
                image.complete
                  ? Promise.resolve()
                  : new Promise((resolve) => {
                      image.onload = resolve;
                      image.onerror = resolve;
                    }),
              ),
            ).then(() => {
              printWindow.focus();
              printWindow.print();
            });
          }}
        >
          Print {kind === "dispatch" ? "Dispatch Order" : "Survey Forms"}
        </Button>
        {canApprove && !plan.approved && !plan.closed && (
          <Button
            variant="primary"
            loading={busy}
            disabled={!verified || !documentLoaded}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                await api(
                  `/project-workflow/survey-dispatch-previews/${plan.id}/approve`,
                  { csrf: session.csrfToken, body: {} },
                );
                await onScheduled();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve Dispatch
          </Button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}
export function DispatchViewer({ session, dispatchId, onBack }: any) {
  const [plan, setPlan] = useState<any>();
  const [error, setError] = useState("");
  const reload = () =>
    api(`/project-workflow/survey-dispatches/${dispatchId}`).then(setPlan);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [dispatchId]);
  return plan ? (
    <div className="pz-stack">
      <DispatchPdfReview session={session} plan={plan} onBack={onBack} />
      {!plan.closed && (
        <Action
          title="Close Dispatch"
          disabled={!plan.canClose}
          onSubmit={async (f) => {
            await api(
              `/project-workflow/survey-dispatches/${dispatchId}/close`,
              { csrf: session.csrfToken, body: { reason: f.get("reason") } },
            );
            await reload();
          }}
        >
          <p>
            Close the dispatch when all its survey reports have been submitted.
            Closed dispatches cannot receive more sites; their documents remain
            available.
          </p>
          {!plan.canClose && (
            <p>Complete or return all surveys before closing this dispatch.</p>
          )}
          <Field id="dispatch-closure-reason" label="Closure remarks">
            <textarea id="dispatch-closure-reason" name="reason" required />
          </Field>
        </Action>
      )}
    </div>
  ) : (
    <section className="pz-panel">
      <Button onClick={onBack}>Back</Button>
      {error ? <ErrorText error={error} /> : <p>Opening survey dispatch…</p>}
    </section>
  );
}
export function SurveySchedulePlan({ session, refs, detail, onScheduled }: any) {
  const r = detail.record;
  const [editing, setEditing] = useState(false);
  const saved = r.stage === "survey_scheduled" && !editing;
  return (
    <Action
      title="Schedule & Assign Surveyors"
      submitLabel={saved ? "Schedule Saved" : "Save Schedule & Surveyors"}
      disabled={saved}
      onSubmit={async (f) => {
        const team = f.getAll("team").map(String);
        if (!team.length) throw new Error("Select at least one surveyor.");
        await api(`/project-workflow/${r.id}/actions`, {
          csrf: session.csrfToken,
          body: {
            action: "assign",
            version: r.version,
            requestKey: crypto.randomUUID(),
            input: {
              date: f.get("date"),
              team,
              notes:
                "Survey date and surveyors saved by Design. Dispatch assignment is a separate step.",
            },
          },
        });
        await onScheduled();
      }}
    >
      <div className="pz-survey-assignment">
        <Input
          name="date"
          title="Scheduled date"
          type="date"
          value={r.data.scheduledSurveyDate || ""}
          readOnly={saved}
          required
        />
        <SurveyorPicker
          refs={refs}
          session={session}
          value={r.data.surveyTeam ?? []}
          disabled={saved}
        />
      </div>
      {saved ? (
        <>
          <p role="status">
            Schedule saved. The date and selected surveyors are recorded.
          </p>
          <Button variant="neutral" onClick={() => setEditing(true)}>
            Edit Schedule
          </Button>
        </>
      ) : (
        <p className="pz-caption">
          Save the date and surveyors. This module stays on the page with a
          Saved confirmation; dispatch is reviewed separately below.
        </p>
      )}
    </Action>
  );
}
export function SurveyDispatchPlan({
  session,
  refs,
  records = [],
  initialId,
  onAssigned,
  onBack,
  embedded = false,
}: any) {
  const [selected, setSelected] = useState<string[]>(
    initialId ? [initialId] : [],
  );
  const [mode, setMode] = useState("new");
  const [dispatch, setDispatch] = useState("");
  const [createdDispatch, setCreatedDispatch] = useState<any>();
  const creationKey = useRef(crypto.randomUUID());
  const [creatingDispatch, setCreatingDispatch] = useState(false);
  const [creationError, setCreationError] = useState("");
  const [plan, setPlan] = useState<any>();
  const eligible = records.filter(
    (site: any) =>
      site.stage === "survey_scheduled" &&
      !site.data.surveyDispatchId &&
      !site.data.surveyInProgress,
  );
  const people = refs.surveyors ?? refs.people;
  if (plan)
    return (
      <DispatchPdfReview
        session={session}
        plan={plan}
        canApprove
        onScheduled={onAssigned}
        onBack={() => setPlan(undefined)}
      />
    );
  return (
    <div className="pz-stack">
      {!embedded && (
        <Button
          variant="neutral"
          onClick={() => {
            if (confirmLeaveWorkspace()) onBack();
          }}
        >
          Back to Scheduled Surveys
        </Button>
      )}
      <Action
        title="Create / Assign Dispatch"
        submitLabel="Review Dispatch"
        disabled={!eligible.length}
        onSubmit={async () => {
          if (!selected.length)
            throw new Error("Select at least one scheduled site.");
          const dispatchId =
            mode === "existing" ? dispatch : createdDispatch?.id;
          if (!dispatchId)
            throw new Error(
              mode === "existing"
                ? "Choose an open dispatch."
                : "Create the dispatch number first.",
            );
          setPlan(
            await api("/project-workflow/survey-dispatches/preview", {
              csrf: session.csrfToken,
              body: { recordIds: selected, dispatchId },
            }),
          );
        }}
      >
        <p>
          Choose the scheduled sites travelling together. Their saved dates and
          surveyors must match. This action does not change their schedules.
        </p>
        {!eligible.length ? (
          <p>No scheduled sites are waiting for dispatch.</p>
        ) : (
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Customer / site</th>
                  <th>Scheduled date</th>
                  <th>Surveyors</th>
                </tr>
              </thead>
              <PagedTableBody label="sites and documents">
                {recentFirst(eligible).map((site: any) => (
                  <tr key={site.id}>
                    <td>
                      <label className="pz-review-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${site.siteCode}`}
                          checked={selected.includes(site.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, site.id]
                                : selected.filter((id) => id !== site.id),
                            )
                          }
                        />
                      </label>
                    </td>
                    <td>
                      {site.customerCode} · {site.site} ({site.siteCode})
                    </td>
                    <td>{site.data.scheduledSurveyDate}</td>
                    <td>
                      {site.data.surveyTeam
                        .map(
                          (id: string) =>
                            people.find((p: any) => p.id === id)
                              ?.display_name ?? "Unconfirmed surveyor",
                        )
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </PagedTableBody>
            </table>
          </div>
        )}
        <div
          className="pz-action-row"
          role="group"
          aria-label="Dispatch action"
        >
          <Button
            variant="neutral"
            loading={creatingDispatch}
            aria-pressed={mode === "new"}
            onClick={async () => {
              setMode("new");
              setCreationError("");
              if (createdDispatch) return;
              setCreatingDispatch(true);
              try {
                setCreatedDispatch(
                  await api("/project-workflow/survey-dispatches", {
                    csrf: session.csrfToken,
                    body: { requestKey: creationKey.current },
                  }),
                );
              } catch (e) {
                setCreationError((e as Error).message);
              } finally {
                setCreatingDispatch(false);
              }
            }}
          >
            Create new dispatch
          </Button>
          <ErrorText error={creationError} />
          <Button
            variant="neutral"
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
          >
            Add to existing dispatch
          </Button>
        </div>
        {mode === "new" ? (
          <Field id="created-survey-dispatch-number" label="Dispatch number">
            <input
              id="created-survey-dispatch-number"
              readOnly
              value={createdDispatch?.number ?? ""}
              placeholder="Click Create new dispatch"
            />
          </Field>
        ) : (
          <Field id="survey-dispatch-number" label="Open dispatch">
            <select
              id="survey-dispatch-number"
              value={dispatch}
              onChange={(e) => setDispatch(e.target.value)}
            >
              <option value="">Choose open dispatch</option>
              {(refs.surveyDispatches ?? []).map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.number} · {item.date || "Not yet assigned"} ·{" "}
                  {item.siteCount} sites
                  {item.surveyors ? ` · ${item.surveyors}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {createdDispatch && mode === "new" && (
          <p role="status">
            Dispatch {createdDispatch.number} created. Review it below before
            approving the site assignment.
          </p>
        )}
        <p className="pz-caption">
          Review the dispatch order and survey forms, then Approve Dispatch to
          group these sites.
        </p>
      </Action>
    </div>
  );
}
export function SurveyorPicker({ refs, session, value = [], disabled = false }: any) {
  const [people, setPeople] = useState<any[]>(
    refs.surveyors ?? refs.people.filter((p: any) => p.role === "Design"),
  );
  const [selected, setSelected] = useState<string[]>(value);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="pz-stack surveyor-picker">
      <span className="surveyor-label">Surveyors — select one or more</span>
      <div className="surveyor-list">
        {people.map((person) => (
          <label className="pz-review-check" key={person.id}>
            <input
              type="checkbox"
              name="team"
              value={person.id}
              disabled={disabled}
              checked={selected.includes(person.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, person.id]
                    : selected.filter((id) => id !== person.id),
                )
              }
            />
            {person.display_name}
            {person.member_code ? ` · ${person.member_code}` : ""}
          </label>
        ))}
      </div>
      {!disabled && (
        <Button variant="secondary" onClick={() => setAdding(!adding)}>
          Add Team Member
        </Button>
      )}
      {adding && (
        <section className="pz-panel">
          <h3>Add surveyor</h3>
          <Field id="surveyor-name" label="Name">
            <input
              id="surveyor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="surveyor-phone" label="Contact number (optional)">
            <input
              id="surveyor-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                if (!name.trim())
                  throw new Error("Enter the team member's name.");
                const member = await api<any>("/project-workflow/surveyors", {
                  csrf: session.csrfToken,
                  body: { name, phone },
                });
                setPeople((rows) =>
                  rows.some((row) => row.id === member.id)
                    ? rows
                    : [...rows, member].sort((a, b) =>
                        a.display_name.localeCompare(b.display_name),
                      ),
                );
                setSelected((ids) =>
                  ids.includes(member.id) ? ids : [...ids, member.id],
                );
                setName("");
                setPhone("");
                setAdding(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save Team Member
          </Button>
          <ErrorText error={error} />
        </section>
      )}
    </div>
  );
}
