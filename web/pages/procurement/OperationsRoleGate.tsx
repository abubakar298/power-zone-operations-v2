import { useEffect, useState } from "react";
import { api, type Session } from "../../api.js";
import { OperationsShell } from "../ops/OperationsShell.js";
import { ProcurementShell } from "./ProcurementShell.js";
import type { Me } from "./types.js";
import "../ops/ops.css";

/**
 * Operations-role logins open one of two workspaces: the Procurement buyer (Hamza) gets Procurement,
 * every other Operations login gets Operations. The server applies the same split to the API.
 */
export function OperationsRoleGate({ session, onLogout, viewingAs, onReturn }: { session: Session; onLogout: () => void; viewingAs?: string; onReturn?: () => void }) {
  const [me, setMe] = useState<Me | "operations" | null>(null);
  useEffect(() => {
    let live = true;
    api<Me>("/procurement/me").then((m) => { if (live) setMe(m); }).catch(() => { if (live) setMe("operations"); });
    return () => { live = false; };
  }, [session.user.id]);
  if (me === null) return <div className="ops"><p className="ops-foot" style={{ padding: 24 }}>Loading…</p></div>;
  if (me !== "operations" && me.buyer) return <ProcurementShell session={session} onLogout={onLogout} viewingAs={viewingAs} onReturn={onReturn} />;
  return <OperationsShell session={session} onLogout={onLogout} viewingAs={viewingAs} onReturn={onReturn} />;
}
