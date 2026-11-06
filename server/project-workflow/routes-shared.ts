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
export const routeNames: Record<string, string> = {
  "survey-quote": "Survey → quotation",
  "quick-quote": "Quick BOQ → quotation",
  "survey-framework": "Survey → pre-agreed recommendation → PO",
  "direct-framework": "Direct PO → pre-agreed configuration",
};

// Display labels only. Stable workflow keys retain record links, filters and history.
const bucketLabels: Record<string,string> = {
  "Survey Requests—Awaiting Scheduling": "Awaiting Schedule",
  "Scheduled Surveys": "Scheduled Surveys",
  "Survey Reports—Awaiting Technical Review": "Technical Review",
  "Submitted to Coordination": "Sent to Coordination",
  "Survey Requests & Tracking": "Survey Requests",
  "Design Outputs—Awaiting Action": "Design Review",
  "Submitted for Management Review": "Management Review",
  "Revisions Required": "Revisions",
  "Approved Documents—Awaiting Dispatch": "Ready to Send",
  "Customer Decision & Order Tracking": "Customer Follow-up",
  "PO / Confirmation Receipt": "PO Receipt / Heads-up",
  "Order Exceptions—Management Review": "Order Exceptions",
  "Advance Planning—Pending Handoff": "Advance Planning",
};
export const bucketLabel = (key:string) => bucketLabels[key] ?? key;

export const iposSharedBucket = "IPOs Shared";
export const visibleCoordinationBuckets = [...coordinationBuckets.slice(0,7),iposSharedBucket];
