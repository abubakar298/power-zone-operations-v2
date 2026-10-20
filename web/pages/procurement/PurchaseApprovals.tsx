import type { Session } from "../../api.js";
import { PurchaseRequests } from "./PurchaseRequests.js";
import "../ops/ops.css";
import "./procurement.css";

/** Abu Bakar's approvals page inside his own workspace: requests waiting for him first, then the rest. */
export function PurchaseApprovals({ session, onChanged }: { session: Session; onChanged?: () => void }) {
  return (
    <div className="ops ops-embed">
      <PurchaseRequests session={session} mode="approver" onChanged={onChanged} />
    </div>
  );
}
