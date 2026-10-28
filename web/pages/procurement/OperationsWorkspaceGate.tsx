import { lazy,Suspense,useEffect, useState } from "react";
import { api, type Session } from "../../api.js";
import { ProcurementShell } from "./ProcurementShell.js";
import type { Me } from "./types.js";
import "../ops/ops.css";
import {Button} from "../../ui/Button.js";
const OperationsBoard=lazy(()=>import('../operations-board/OperationsBoard.js').then(m=>({default:m.OperationsBoard})));

/** Assigned board staff open the scoped Operations interface. Procurement
 * buyers retain their Procurement workspace; every other Operations login uses the scoped board.
 * A failed capability check never guesses an interface. */
export function OperationsWorkspaceGate({ session, onLogout, viewingAs, onReturn }: { session: Session; onLogout: () => void; viewingAs?: string; onReturn?: () => void }) {
  const [me, setMe] = useState<(Me & {operationsBoard?:unknown}) | "error" | null>(null),[attempt,setAttempt]=useState(0);
  useEffect(() => {
    let live = true;
    api<Me & {operationsBoard?:unknown}>("/procurement/me").then((m) => { if (live){if(!m.buyer&&!location.pathname.startsWith('/operations'))history.replaceState(null,'','/operations/sites');setMe(m); } }).catch(() => { if (live) setMe("error"); });
    return () => { live = false; };
  }, [session.user.id,attempt]);
  if (me === null) return <div className="ops"><p className="ops-foot" style={{ padding: 24 }}>Loading…</p></div>;
  if(me==='error')return <section className="pz-panel pz-stack"><p role="alert">Unable to open your assigned workspace.</p><Button onClick={()=>{setMe(null);setAttempt(v=>v+1);}}>Try again</Button></section>;
  if (me.buyer && !(me.operationsBoard && location.pathname.startsWith('/operations/'))) return <ProcurementShell session={session} onLogout={onLogout} viewingAs={viewingAs} onReturn={onReturn} />;
  return <Suspense fallback={<p role="status">Opening assigned Operations sites…</p>}>{onReturn&&<Button onClick={onReturn}>Return to Management</Button>}<OperationsBoard session={session} onLogout={onLogout}/></Suspense>;
}
