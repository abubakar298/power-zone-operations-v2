import type { Session } from "../../api.js";
import { PurchaseRequests } from "./PurchaseRequests.js";
import "../ops/ops.css";
import "./procurement.css";

/**
 * Abu Bakar's approvals page inside his own workspace: requests waiting for him first, then the rest.
 * Accounts gets the same list read-only (mode "reader", 24 Oct 2026); the server decides every button.
 */
export function PurchaseApprovals({ session, onChanged, mode = "approver" }: { session: Session; onChanged?: () => void; mode?: "approver" | "reader" }) {
  return (
    <div className="ops ops-embed">
      <PurchaseRequests session={session} mode={mode} onChanged={onChanged} />
    </div>
  );
}
