import { lazy, Suspense, useEffect, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { BackButton } from "../../components/BackButton.js";
import { Brand } from "../../components/Brand.js";
import { Icon } from "../../components/Icon.js";
import { ManagementHeaderSwitcher } from "../../components/ManagementHeaderSwitcher.js";
import { NotificationCenter } from "../../components/NotificationCenter.js";
import { WorkspaceAccountMenu } from "../../components/WorkspaceAccountMenu.js";
import { confirmLeaveWorkspace } from "../../hooks/useUnsavedChanges.js";
import { Button } from "../../ui/Button.js";
import { PurchaseRequests } from "./PurchaseRequests.js";
import { ProcurementSuppliers } from "./Suppliers.js";
import { ProcurementWarehouseStock } from "./WarehouseStock.js";
import "../../components/inventory-navigation.css";
import "../operations-board/operations-board.css";
import "../ops/ops.css";
import "./procurement.css";

const PasswordChange = lazy(() => import("../Dashboard.js").then(module => ({ default: module.PasswordChange })));
const pages = [
  { id: "warehouse-stock", title: "Warehouse stock", icon: "boxes" },
  { id: "requests", title: "Purchase requests", icon: "documents" },
  { id: "suppliers", title: "Suppliers", icon: "store" },
  { id: "account", title: "My account", icon: "users" },
] as const;
type View = typeof pages[number]["id"];

function currentView(): View {
  const requested = new URLSearchParams(window.location.hash.slice(1)).get("workspace");
  return pages.find(page => page.id === requested)?.id ?? "warehouse-stock";
}

export function ProcurementShell({ session, onLogout, onReturn }: {
  session: Session;
  onLogout: () => void;
  viewingAs?: string;
  onReturn?: () => void;
}) {
  const [view, setView] = useState(currentView);
  const [mobile, setMobile] = useState(false);
  const [openRequest, setOpenRequest] = useState<string>();
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const follow = () => {
      setView(currentView());
      setMobile(false);
    };
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  function go(next: View, request?: string) {
    if (!confirmLeaveWorkspace()) return;
    setView(next);
    setMobile(false);
    if (next === "requests") setOpenRequest(request);
    if (window.location.hash !== "#workspace=" + next) {
      window.history.pushState(null, "", "/dashboard#workspace=" + next);
    }
    window.scrollTo(0, 0);
  }

  async function logout() {
    if (signingOut || !confirmLeaveWorkspace()) return;
    setSigningOut(true);
    try {
      const current = await api<Session>("/auth/session");
      await api("/auth/logout", { body: {}, csrf: current.csrfToken });
      onLogout();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onLogout();
      else setError(error instanceof ApiError ? error.message : "Could not sign out.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="ob-shell">
      <header className="ob-header">
        <Button className="ob-mobile-toggle" aria-label="Open navigation" aria-expanded={mobile} onClick={() => setMobile(!mobile)}><Icon name="menu" /></Button>
        <Button className="ob-brand" aria-label="Power Zone — Dashboard" onClick={() => go("warehouse-stock")}><Brand compact department="Procurement" /></Button>
        <BackButton />
        <div className="ob-header-actions">
          <NotificationCenter session={session} onOpen={() => undefined} />
          <ManagementHeaderSwitcher session={session} value="operations" operationsArea="procurement" />
          <WorkspaceAccountMenu name={session.user.displayName} label="Procurement" disabled={signingOut} onSignOut={onReturn ?? (() => void logout())} signOutLabel={onReturn ? "Return to Management" : undefined} />
        </div>
      </header>
      <aside data-staff-sidebar className={`ob-sidebar inventory-sidebar ${mobile ? "is-open" : ""}`}>
        <nav aria-label="Main">
          {pages.map(page => <Button key={page.id} className={view === page.id ? "is-active" : ""} aria-current={view === page.id ? "page" : undefined}
            onClick={() => go(page.id)}><Icon name={page.icon} /><span>{page.title}</span></Button>)}
        </nav>
      </aside>
      <main className="ob-main">
        <div className="ob-page-title"><div><h1>{pages.find(page => page.id === view)?.title}</h1></div></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="ops ops-embed">
          {view === "warehouse-stock" && <ProcurementWarehouseStock session={session} onCreated={id => go("requests", id)} />}
          {view === "requests" && <PurchaseRequests session={session} mode="buyer" openId={openRequest} onNewRequest={() => go("warehouse-stock")} key={openRequest ?? "list"} />}
          {view === "suppliers" && <ProcurementSuppliers session={session} />}
          {view === "account" && <div className="pz-stack">
            <section className="pz-panel pz-stack">
              <h2>Your account</h2>
              <div className="ops-kv"><div><span>Name</span><b>{session.user.displayName}</b></div><div><span>Email</span><b>{session.user.email}</b></div></div>
            </section>
            <section className="pz-panel pz-stack">
              <h2>Change password</h2>
              <Suspense fallback={null}><PasswordChange session={session} onChanged={onLogout} /></Suspense>
            </section>
          </div>}
        </div>
      </main>
    </div>
  );
}
