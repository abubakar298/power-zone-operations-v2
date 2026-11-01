import { HttpError } from "../http/errors.js";
export const ublStages = [
  "Survey Requests & Tracking",
  "Recommendations—Pending Submission",
  "Recommendations Submitted—Awaiting PO",
  "Heads-up Received—Preparation Pending",
  "Advance BOQ Sent—Awaiting PO",
  "PO Received—IPO Preparation",
  "IPO Submitted—Awaiting Accounts",
  "Accounts Accepted—BOQ Issuance Pending",
] as const;
export const ublConfigurations = [
  "20-20-30",
  "25-20-30",
  "30-30-40",
  "35-30-40",
] as const;
export type WorkflowAction =
  | "historical-po"
  | "sample-accept"
  | "sample-return"
  | "sample"
  | "save"
  | "identity"
  | "verify"
  | "submit"
  | "headsup"
  | "advance"
  | "po"
  | "ipo"
  | "accept"
  | "return"
  | "confirmed"
  | "acknowledge"
  | "revision-pending"
  | "defer"
  | "decline";
export function transition(
  stage: string,
  action: WorkflowAction,
  role: string,
  data: any,
) {
  const manager = ["Admin", "Management"].includes(role),
    can = (roles: string[]) => manager || roles.includes(role);
  if (
    !can(
      action === "verify"
        ? ["Design"]
        : ["accept", "return", "sample-accept", "sample-return"].includes(
              action,
            )
          ? ["Accounts"]
          : action === "acknowledge"
            ? ["Operations"]
            : action === "save"
              ? ["Design", "Coordinator"]
              : ["Coordinator"],
    )
  )
    throw new HttpError(403, "Your department cannot perform this action.");
  if (["sample-accept", "sample-return"].includes(action)) {
    if (!data.accountsReviewSample)
      throw new HttpError(409, "No review sample has been received.");
    return stage;
  }
  if(action==='historical-po'){
    if(!manager||!data.originalOrderPreserved||!data.ipoNumber||stage!=='Existing job—Revised PO pending')throw new HttpError(403,'Only Management can register the revised PO for this preserved historical order.');
    return 'Existing order—Revised PO recorded';
  }
  if (action === "sample") {
    if (!manager)
      throw new HttpError(403, "Only Management can send a review sample.");
    if (
      stage !== ublStages[3] ||
      !ublConfigurations.includes(data.configuration)
    )
      throw new HttpError(
        422,
        "A heads-up with a standard configuration is required for this sample.",
      );
    return stage;
  }
  if (action === "revision-pending") {
    if (!manager || !data.originalOrderPreserved || !data.ipoNumber)
      throw new HttpError(
        403,
        "Only Management can classify an existing job as awaiting a revised PO.",
      );
    if (![ublStages[3], "Existing job—Revised PO pending"].includes(stage))
      throw new HttpError(
        409,
        "Only an existing heads-up can be reclassified.",
      );
    return "Existing job—Revised PO pending";
  }
  if (action === "save") return stage;
  if (action === "identity") {
    if (!manager)
      throw new HttpError(
        403,
        "Administrator or Management confirms an unresolved site identity.",
      );
    return stage;
  }
  if (action === "acknowledge") {
    if (![ublStages[4], "Confirmed BOQ issued"].includes(stage))
      throw new HttpError(409, "There is no issued BOQ to acknowledge.");
    return stage;
  }
  if (
    ["verify", "submit", "advance", "po", "ipo", "confirmed"].includes(
      action,
    ) &&
    !ublConfigurations.includes(data.configuration)
  )
    throw new HttpError(
      422,
      "Select and verify one of the four agreed configurations first.",
    );
  if (
    ["submit", "advance", "po", "ipo", "confirmed"].includes(action) &&
    !data.technicalVerified
  )
    throw new HttpError(
      422,
      "Design technical verification is required before this release.",
    );
  if (action === "verify") {
    if (
      ![
        ...ublStages.slice(0, 5),
        "Deferred",
        "Existing job—Revised PO pending",
      ].includes(stage) &&
      !(stage === ublStages[5] && data.returnReason)
    )
      throw new HttpError(
        409,
        "An order already exists. Use a controlled PO revision.",
      );
    return stage === ublStages[0] ? ublStages[1] : stage;
  }
  if (action === "submit") {
    if (stage !== ublStages[1])
      throw new HttpError(
        409,
        "This recommendation is not awaiting submission.",
      );
    return ublStages[2];
  }
  if (action === "headsup") {
    if (![ublStages[0], ublStages[1], ublStages[2], "Deferred"].includes(stage))
      throw new HttpError(409, "Heads-up already recorded or an order exists.");
    return ublStages[3];
  }
  if (action === "advance") {
    if (stage !== ublStages[3])
      throw new HttpError(
        409,
        "Record the heads-up before sending an advance BOQ.",
      );
    return ublStages[4];
  }
  if (action === "po") {
    if (
      ![
        ublStages[1],
        ublStages[2],
        ublStages[3],
        ublStages[4],
        "Deferred",
        "Existing job—Revised PO pending",
      ].includes(stage)
    )
      throw new HttpError(409, "This site is not awaiting a PO.");
    return ublStages[5];
  }
  if (action === "ipo") {
    if (stage !== ublStages[5] || !data.poNumber)
      throw new HttpError(
        409,
        "Record and reconcile the actual PO before preparing the IPO.",
      );
    return ublStages[6];
  }
  if (action === "accept" || action === "return") {
    if (stage !== ublStages[6])
      throw new HttpError(409, "The IPO is not awaiting Accounts review.");
    return action === "accept" ? ublStages[7] : ublStages[5];
  }
  if (action === "confirmed") {
    if (stage !== ublStages[7])
      throw new HttpError(
        409,
        "Accounts must accept the IPO before confirmed BOQ issuance.",
      );
    return "Confirmed BOQ issued";
  }
  if (["defer", "decline"].includes(action)) {
    if (!ublStages.slice(0, 5).includes(stage as any))
      throw new HttpError(
        409,
        "An actual order cannot be deferred through the heads-up workflow.",
      );
    return action === "defer" ? "Deferred" : "Declined";
  }
  throw new HttpError(400, "Unknown workflow action.");
}
export function publicDocument(snapshot: any, role: string) {
  const copy = structuredClone(snapshot);
  if (!["Admin", "Management", "Accounts"].includes(role)) {
    delete copy.baseline;
    delete copy.budgetSnapshot;
    if (copy.sample) {
      copy.sample.phases = copy.sample.phases.map(
        ({ budgetedCost, markup, ...p }: any) => p,
      );
      for (const k of [
        "budgetedCost",
        "markupAmount",
        "markupPercent",
        "installationMarkupPercent",
        "reviewNotes",
      ])
        delete copy.sample[k];
    }
  }
  return copy;
}
