export const designBuckets = [
  "Survey Requests—Awaiting Scheduling",
  "Scheduled Surveys",
  "Survey Reports—Awaiting Technical Review",
  "Submitted to Coordination",
];
export const coordinationBuckets = [
  "Survey Requests & Tracking",
  "Design Outputs—Awaiting Action",
  "Submitted for Management Review",
  "Revisions Required",
  "Approved Documents—Awaiting Dispatch",
  "Customer Decision & Order Tracking",
  "PO / Confirmation Receipt",
  "Order Exceptions—Management Review",
  "Advance Planning—Pending Handoff",
];
export const routes = [
  "Survey → quotation",
  "Quick BOQ → quotation",
  "Survey → pre-agreed recommendation → PO",
  "Direct PO → pre-agreed configuration",
];
export function designBucket(row: any) {
  if (row.draft_id) return designBuckets[3];
  const d = row.data ?? row.inputs ?? {};
  if (d.returnReason || d.revisionReason) return designBuckets[2];
  if (d.technicalVerified || (d.workflowStage === designBuckets[2] || d.workflowStage === "Technical Review & Handoff Preparation"))
    return designBuckets[2];
  if (d.surveyStatus === "Completed" || (d.workflowStage === designBuckets[2] || d.workflowStage === "Technical Review & Handoff Preparation"))
    return designBuckets[2];
  if (
    ["Scheduled", "In progress"].includes(d.surveyStatus) ||
    d.workflowStage === designBuckets[1]
  )
    return designBuckets[1];
  return d.workflowStage ?? (row.inputs ? designBuckets[2] : designBuckets[0]);
}
export function coordinationBucket(t: any) {
  if (t.framework) {
    const r = t.framework,
      d = r.data ?? {};
    if (d.returnReason) return coordinationBuckets[3];
    if (r.stage.includes("Heads-up Received")) return coordinationBuckets[8];
    if (r.stage.includes("Recommendation") && r.stage.includes("Pending"))
      return coordinationBuckets[4];
    if (r.stage.includes("Survey Requests"))
      return d.technicalVerified
        ? coordinationBuckets[1]
        : coordinationBuckets[0];
    if (
      r.stage.includes("Awaiting PO") ||
      ["Deferred", "Declined"].includes(r.stage)
    )
      return coordinationBuckets[5];
    return coordinationBuckets[6];
  }
  if (t.stage === "Quotation approval" || t.status === "Awaiting review")
    return coordinationBuckets[2];
  if (t.stage === "Revision required") return coordinationBuckets[3];
  if (t.stage === "Approved quotations awaiting send")
    return coordinationBuckets[4];
  if (t.stage === "Customer confirmation")
    return t.status?.includes("IPO draft pending")
      ? coordinationBuckets[6]
      : coordinationBuckets[5];
  if (["IPO approval", "Operations & Accounts Handoff"].includes(t.stage))
    return coordinationBuckets[6];
  return coordinationBuckets[1];
}
export function frameworkTask(r: any) {
  return {
    id: r.id,
    kind: "Framework recommendation",
    framework: r,
    customer: "UBL",
    site: r.site_name,
    reference: r.data?.ipoNumber ? `CHP-${r.data.ipoNumber}` : r.branch_code,
    stage: r.stage,
    status: r.stage,
    started_at: r.updated_at ?? r.created_at,
    ownerId: r.data?.technicalOwnerId ?? r.data?.planningOwnerId,
    person: r.technical_owner ?? r.planning_owner ?? "Unassigned",
    region:
      r.data?.region ??
      r.source?.branch?.Region ??
      r.source?.region ??
      "Not entered",
    route: routes[2],
    target: "ubl-workflow",
    blocker: r.data?.returnReason ?? r.data?.flags?.join?.("; ") ?? "",
  };
}
export function taskDay(value: any) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA") : "";
}
export function taskAge(value: any) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? `${Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))} days`
    : "Not recorded";
}
