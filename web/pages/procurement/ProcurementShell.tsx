import { useEffect, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { BackButton } from "../../components/BackButton.js";
import { Brand } from "../../components/Brand.js";
import { Icon } from "../../components/Icon.js";
import { OperationsProcurementSwitcher } from "../../components/OperationsProcurementSwitcher.js";
import { ManagementHeaderSwitcher } from "../../components/ManagementHeaderSwitcher.js";
import { WorkspaceAccountMenu } from "../../components/WorkspaceAccountMenu.js";
import { confirmLeaveWorkspace } from "../../hooks/useUnsavedChanges.js";
import { Button } from "../../ui/Button.js";
import { AccountsPurchases } from "./AccountsPurchases.js";
import { PurchaseRequests } from "./PurchaseRequests.js";
import { ProcurementSuppliers } from "./Suppliers.js";
import { ProcurementWarehouseStock } from "./WarehouseStock.js";
import "../ops/ops.css";
import "./procurement.css";
import "./workspace.css";

const work = [
  { id: "warehouse-stock", title: "Stock overview", icon: "dashboard" },
  { id: "requests", title: "Requests & RFQs", icon: "file" },
  { id: "suppliers", title: "Suppliers", icon: "users" },
] as const;
const handoffs = [
  { id: "approvals", title: "Owner approvals", icon: "shield" },
  { id: "accounts", title: "Accounts · Salaas", icon: "file" },
  { id: "inventory", title: "Inventory · IGPO", icon: "warehouse" },
] as const;
const pages = [...work, ...handoffs];
type View = typeof pages[number]["id"];

function currentView(): View {
  const requested = new URLSearchParams(window.location.hash.slice(1)).get("workspace");
  return pages.find(page => page.id === requested)?.id ?? "warehouse-stock";
}

export function ProcurementShell({ session, onLogout, onReturn, onOpenAccounts, canSwitchToOperations }: {
  session: Session;
  onLogout: () => void;
  viewingAs?: string;
  onReturn?: () => void;
  onOpenAccounts?: () => void;
  canSwitchToOperations?: boolean;
}) {
  const [view, setView] = useState(currentView);
  const [mobile, setMobile] = useState(false);
  const [openRequest, setOpenRequest] = useState<string>();
  const [createRequested, setCreateRequested] = useState(0);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const follow = () => {
      setView(currentView());
      setCreateRequested(0);
      setMobile(false);
    };
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  function go(next: View, request?: string) {
    if (!confirmLeaveWorkspace()) return false;
    setView(next);
    setMobile(false);
    setCreateRequested(0);
    if (next === "requests") setOpenRequest(request);
    if (window.location.hash !== "#workspace=" + next) {
      window.history.pushState(null, "", "/dashboard#workspace=" + next);
    }
    window.scrollTo(0, 0);
    return true;
  }

  function createDraft() {
    if (go("warehouse-stock")) setCreateRequested(Date.now());
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

  const navButton = (page: typeof pages[number]) => (
    <Button key={page.id} aria-current={view === page.id ? "page" : undefined} onClick={() => go(page.id)}>
      <Icon name={page.icon} /><span>{page.title}</span>
    </Button>
  );

  return (
    <div className="procurement-workspace">
      <header className="procurement-topbar">
        <Button className="procurement-menu-toggle" aria-label="Toggle navigation" aria-controls="procurement-sidebar" aria-expanded={mobile} onClick={() => setMobile(!mobile)}><Icon name="menu" /></Button>
        <Button className="procurement-brand" aria-label="Power Zone — Dashboard" onClick={() => go("warehouse-stock")}><Brand compact /><span className="procurement-brand-label">Procurement</span></Button>
        <div className="procurement-breadcrumb">Workspace / <strong>Procurement</strong></div>
        <div className="procurement-header-actions">
          <Button variant="primary" onClick={createDraft}>Create request</Button>
          {canSwitchToOperations && <OperationsProcurementSwitcher area="procurement" />}
          <ManagementHeaderSwitcher session={session} value="operations" operationsArea="procurement" />
          <WorkspaceAccountMenu name={session.user.displayName} label="Procurement" disabled={signingOut}
            onSignOut={onReturn ?? (() => void logout())} signOutLabel={onReturn ? "Return to Management" : undefined} />
        </div>
      </header>
      <aside id="procurement-sidebar" data-staff-sidebar className={`procurement-sidebar ${mobile ? "menu-open" : ""}`}>
        <nav aria-label="Procurement workspace">
          <p className="procurement-nav-label">Workspace</p>
          {work.map(navButton)}
          <p className="procurement-nav-label">Department handoffs</p>
          {handoffs.map(navButton)}
        </nav>
      </aside>
      <main className="procurement-content"><div className="pz-page-back"><BackButton/></div>
        {view !== "warehouse-stock" && <div className="procurement-page-head"><h1>{pages.find(page => page.id === view)?.title}</h1></div>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="ops ops-embed">
          {view === "warehouse-stock" && <ProcurementWarehouseStock session={session} onCreated={id => go("requests", id)} createRequested={createRequested} />}
          {view === "requests" && <PurchaseRequests session={session} mode="buyer" openId={openRequest} onNewRequest={createDraft} key={openRequest ?? "list"} />}
          {view === "suppliers" && <ProcurementSuppliers session={session} />}
          {view === "approvals" && <PurchaseRequests session={session} mode="approver" />}
          {view === "accounts" && <>
            {onOpenAccounts && <div className="procurement-page-head"><Button variant="secondary" onClick={onOpenAccounts}>Open Accounts workspace</Button></div>}
            <AccountsPurchases session={session} />
          </>}
          {view === "inventory" && <>
            {onReturn && <div className="procurement-page-head"><Button variant="secondary" onClick={() => {
              if (confirmLeaveWorkspace()) window.location.assign("/inventory/purchase-receiving");
            }}>Open Inventory receiving</Button></div>}
            <PurchaseRequests session={session} mode="reader" inventoryOnly />
          </>}
        </div>
      </main>
    </div>
  );
}
