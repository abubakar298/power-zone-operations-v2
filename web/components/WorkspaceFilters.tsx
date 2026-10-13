import { Field } from "../ui/Field.js";
import { Button } from "../ui/Button.js";
import { taskDay } from "../workspaces/tasks.js";
import { useState, type ReactNode } from "react";
export const emptyWorkspaceFilters = {
  search: "",
  customer: "",
  site: "",
  person: "",
  region: "",
  route: "",
  date: "",
  period: "all",
};
export type WorkspaceFilterValues = typeof emptyWorkspaceFilters;
export function matchesWorkspace(t: any, f: WorkspaceFilterValues) {
  return (
    (!f.search ||
      [t.customer, t.site, t.reference, t.person, t.blocker, t.route]
        .join(" ")
        .toLowerCase()
        .includes(f.search.toLowerCase())) &&
    ["customer", "site", "person", "region", "route"].every(
      (k) =>
        !f[k as keyof WorkspaceFilterValues] ||
        t[k] === f[k as keyof WorkspaceFilterValues],
    ) &&
    (!f.date || taskDay(t.started_at) === taskDay(f.date)) &&
    (f.period !== "today" || taskDay(t.started_at) === taskDay(new Date())) &&
    (f.period !== "overdue" || t.overdue)
  );
}
export function WorkspaceFilters({
  rows,
  value,
  onChange,
  searchLabel = "Search tasks",
  showTaskModes = true,
  compact = false,
  extraFilters,
}: {
  rows: any[];
  value: WorkspaceFilterValues;
  onChange: (v: WorkspaceFilterValues) => void;
  searchLabel?: string;
  showTaskModes?: boolean;
  compact?: boolean;
  extraFilters?:ReactNode;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const change = (key: keyof WorkspaceFilterValues, v: string) =>
    onChange({ ...value, [key]: v });
  const dimensions = ["customer", "site", "person", "region", "route"] as const;
  const activeFilters = [...dimensions, "date" as const].filter((key) => value[key]).length;
  if (compact) return <div className="pz-compact-filters">
    {showTaskModes && <div className="pz-action-row workspace-groups">
      {[["all", "All pending tasks"], ["today", "Daily tasks"], ["overdue", "Overdue tasks"]].map(([period, title]) => <Button key={period} variant="neutral" aria-pressed={value.period === period} onClick={() => change("period", period)}>{title}</Button>)}
    </div>}
    <div className="pz-filter-toolbar">
      <div className="pz-filter-search"><Field id="task-search" label={searchLabel}>
        <input id="task-search" type="search" placeholder="Customer, site or reference" value={value.search} onChange={(e) => change("search", e.target.value)} />
      </Field></div>
      <Button variant="neutral" aria-expanded={filtersOpen} aria-controls="task-extra-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
        Filters{activeFilters ? ` (${activeFilters})` : ""}
      </Button>
      {(activeFilters > 0 || value.search) && <Button variant="neutral" onClick={() => onChange({...emptyWorkspaceFilters})}>Clear</Button>}
    </div>
    {filtersOpen && <div id="task-extra-filters" className="pz-filter-options">
      {dimensions.map((key) => <Field key={key} id={`task-${key}`} label={key === "person" ? "Responsible person" : key.charAt(0).toUpperCase()+key.slice(1)}>
        <select id={`task-${key}`} value={value[key]} onChange={(e) => change(key,e.target.value)}>
          <option value="">All</option>
          {[...new Set<string>(rows.map((row) => row[key]).filter(Boolean))].sort().map((option) => <option key={option}>{option}</option>)}
        </select>
      </Field>)}
      {extraFilters}
      <Field id="task-date" label="Recorded task date"><input id="task-date" type="date" value={value.date} onChange={(e) => change("date",e.target.value)} /></Field>
    </div>}
  </div>;
  return (
    <div className="pz-stack">
      <div className="pz-action-row">
        {showTaskModes && <>
        {[
          ["all", "All pending tasks"],
          ["today", "Daily tasks"],
          ["overdue", "Overdue tasks"],
        ].map(([v, label]) => (
          <Button
            key={v}
            variant="neutral"
            aria-pressed={value.period === v}
            onClick={() => change("period", v)}
          >
            {label}
          </Button>
        ))}
        </>}
        <Button
          variant="neutral"
          onClick={() => onChange({ ...emptyWorkspaceFilters })}
        >
          Clear filters
        </Button>
      </div>
      <div className="pz-form-grid">
        <Field id="task-search" label={searchLabel} hint="Search customer, site or reference within these records.">
          <input
            id="task-search"
            value={value.search}
            onChange={(e) => change("search", e.target.value)}
            type="search"
          />
        </Field>
        {["customer", "site", "person", "region", "route"].map((k) => (
          <Field
            key={k}
            id={`task-${k}`}
            label={
              k === "person"
                ? "Responsible person"
                : k.charAt(0).toUpperCase() + k.slice(1)
            }
          >
            <select
              id={`task-${k}`}
              value={value[k as keyof WorkspaceFilterValues]}
              onChange={(e) =>
                change(k as keyof WorkspaceFilterValues, e.target.value)
              }
            >
              <option value="">All</option>
              {[...new Set<string>(rows.map((t) => t[k]).filter(Boolean))]
                .sort()
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </Field>
        ))}
        <Field id="task-date" label="Filter by recorded task date" hint="Dates are recorded automatically; this only filters the list.">
          <input
            id="task-date"
            type="date"
            value={value.date}
            onChange={(e) => change("date", e.target.value)}
          />
        </Field>
      </div>
      {showTaskModes && <p className="pz-caption">
        Daily tasks are records created or updated today. Overdue uses a
        recorded target or scheduled survey date; missing dates are not treated
        as overdue.
      </p>}
    </div>
  );
}
