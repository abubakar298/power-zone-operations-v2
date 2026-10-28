import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, type Session } from "./api.js";
import { AuthLayout } from "./components/AuthLayout.js";
import { AccountLink } from "./pages/AccountLink.js";
import { Login } from "./pages/Login.js";
import { Setup } from "./pages/Setup.js";
import { Dashboard } from "./pages/Dashboard.js";
import {clearDepartmentUser} from './department-view.js';

const OperationsBoard=lazy(()=>import('./pages/operations-board/OperationsBoard.js').then(m=>({default:m.OperationsBoard})));
const InventoryRoleGate=lazy(()=>import('./pages/InventoryRoleGate.js').then(m=>({default:m.InventoryRoleGate})));
const ParentDos=lazy(()=>import('./pages/ParentDos.js').then(m=>({default:m.ParentDos})));
const InventoryReviews=lazy(()=>import('./pages/InventoryReviews.js').then(m=>({default:m.InventoryReviews})));
const GatePasses=lazy(()=>import('./pages/GatePasses.js').then(m=>({default:m.GatePasses})));
const SiteMaterials=lazy(()=>import('./pages/SiteMaterials.js').then(m=>({default:m.SiteMaterials})));
const WarehouseTransfers=lazy(()=>import('./pages/WarehouseTransfers.js').then(m=>({default:m.WarehouseTransfers})));
const MaterialReplacements=lazy(()=>import('./pages/MaterialReplacements.js').then(m=>({default:m.MaterialReplacements})));

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "authenticated"; session: Session };
export function App() {
  const [oiaEntry]=useState(()=>/^\/(?:operations(?:\/|$)|inventory\/(?:materials|parent-dos|reconciliations|gate-passes|transfers|replacements)(?:\/|$)|accounts(?:\/|$))/.test(window.location.pathname)?window.location.pathname+window.location.search:'');
  const [pricingCarryLink]=useState(()=>{const token=new URLSearchParams(window.location.search).get('pricingPreviewToken');return token&&/^[0-9a-f-]{36}$/i.test(token)?`?pricingPreviewToken=${token}#workspace=pricing`:'';});
  const [notificationLink] = useState(()=>{
    const hash=window.location.hash,params=new URLSearchParams(hash.slice(1));
    return /^#notification=[0-9a-f-]{36}$/i.test(hash)||["dashboard","projects","documents","ubl","ubl-workflow","account","team","masters","boqs","newboq","pricing","quotes","orders","reports","rates","coordination","design","operations","inventory","finance","alerts","ubl-ups","mbl-ups","bafl-solar"].includes(params.get("workspace")??"")?hash:"";
  });
  const [state, setState] = useState<State>({ kind: "loading" });
  const [linkPage, setLinkPage] = useState(
    window.location.pathname === "/account-link"
      ? "link"
      : window.location.pathname === "/forgot-password"
        ? "recover"
        : "",
  );
  const [setupComplete, setSetupComplete] = useState(false);
  const go = useCallback(
    (path: string, role?: Session["user"]["role"]) => window.history.replaceState(null, "", (path==="/dashboard"&&oiaEntry&&(!role||!["Coordinator","Design","Employee"].includes(role))?oiaEntry+(/^#notification=[0-9a-f-]{36}$/i.test(notificationLink)?notificationLink:""):path+(path==="/dashboard"?(pricingCarryLink||notificationLink):""))),
    [notificationLink,pricingCarryLink,oiaEntry],
  );
  const signedOut = useCallback(() => {
    clearDepartmentUser();
    setState({ kind: "login" });
    go("/login");
  }, [go]);
  async function load() {
    setState({ kind: "loading" });
    try {
      const status = await api<{ setupRequired: boolean }>("/auth/status");
      if (status.setupRequired) {
        setState({ kind: "setup" });
        go("/setup");
        return;
      }
      try {
        const session = await api<Session>("/auth/session");
        setState({ kind: "authenticated", session });
        go("/dashboard", session.user.role);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) signedOut();
        else throw err;
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unable to connect.",
      });
    }
  }
  useEffect(() => {
    if (!linkPage) void load();
  }, []);
  // Idle sign-out (Moaz, 24 Oct 2026): the server ends a session after PZ_IDLE_MINUTES without real activity.
  useEffect(() => {
    const ended = (e: Event) => {
      const message = (e as CustomEvent<string>).detail ?? "";
      if (state.kind !== "authenticated") return;
      try { if (message) sessionStorage.setItem("pz:signed-out", message); } catch { /* the sign-in page then shows no reason */ }
      signedOut();
    };
    window.addEventListener("pz:session-ended", ended);
    return () => window.removeEventListener("pz:session-ended", ended);
  }, [signedOut, state.kind]);
  useEffect(() => {
    if (state.kind !== "authenticated") return;
    let lastPing = Date.now();
    // A click, key press or scroll counts as activity even when it loads nothing (reading a long page).
    const active = () => { if (Date.now() - lastPing > 120_000) { lastPing = Date.now(); void api("/auth/session").catch(() => undefined); } };
    const names = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const name of names) window.addEventListener(name, active, { passive: true });
    // A quiet check every minute notices an ended session even when nothing is clicked.
    const timer = setInterval(() => void api("/auth/session").catch(() => undefined), 60_000);
    return () => { for (const name of names) window.removeEventListener(name, active); clearInterval(timer); };
  }, [state.kind]);
  if (linkPage)
    return (
      <AuthLayout>
        <AccountLink
          recover={linkPage === "recover"}
          onBack={() => {
            setLinkPage("");
            void load();
          }}
        />
      </AuthLayout>
    );
  if (state.kind === "authenticated") {
    const props={session:state.session,onLogout:signedOut};
    if(["Coordinator","Design","Employee"].includes(state.session.user.role))return <Dashboard {...props}/>;
    if(oiaEntry.startsWith('/operations'))return <Suspense fallback={<p role="status">Opening Operations…</p>}><OperationsBoard {...props}/></Suspense>;
    if(oiaEntry.startsWith('/inventory/'))return <Suspense fallback={<p role="status">Opening Inventory…</p>}>{oiaEntry.startsWith('/inventory/materials')&&(location.pathname.split('/').filter(Boolean).length>2||new URLSearchParams(location.search).has('site'))?<SiteMaterials {...props}/>:(oiaEntry.startsWith('/inventory/parent-dos')||oiaEntry.split('?')[0].replace(/\/$/,'')==='/inventory/materials')?<ParentDos {...props}/>:oiaEntry.startsWith('/inventory/gate-passes')?<GatePasses {...props}/>:oiaEntry.startsWith('/inventory/transfers')?<WarehouseTransfers {...props}/>:oiaEntry.startsWith('/inventory/replacements')?<MaterialReplacements {...props}/>:<InventoryReviews {...props}/>}</Suspense>;
    if(state.session.user.role==='Inventory')return <Suspense fallback={<p role="status">Opening assigned Inventory…</p>}><InventoryRoleGate {...props}/></Suspense>;
    return <Dashboard {...props}/>;
  }
  return (
    <AuthLayout>
      {state.kind === "loading" && (
        <section className="auth-card" role="status">
          <span className="eyebrow">POWER ZONE OPERATIONS</span>
          <h1>Opening your workspace…</h1>
        </section>
      )}
      {state.kind === "error" && (
        <section className="auth-card">
          <h1>Let’s reconnect.</h1>
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <button
            className="primary"
            onClick={() => {
              void load();
            }}
          >
            Try again
          </button>
        </section>
      )}
      {state.kind === "setup" && (
        <Setup
          onComplete={() => {
            setSetupComplete(true);
            signedOut();
          }}
        />
      )}
      {state.kind === "login" && (
        <Login
          onRecover={() => {
            setLinkPage("recover");
            go("/forgot-password");
          }}
          setupComplete={setupComplete}
          onLogin={(session) => {
            setState({ kind: "authenticated", session });
            go("/dashboard", session.user.role);
          }}
        />
      )}
    </AuthLayout>
  );
}
