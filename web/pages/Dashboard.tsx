import { lazy, Suspense, useEffect, useState } from "react";
import { WorkspaceBoundary } from "../components/WorkspaceBoundary.js";
import { api, ApiError, type Session, type User } from "../api.js";
import { Brand } from "../components/Brand.js";
import { Icon } from "../components/Icon.js";

const Design = lazy(() => import("./Design.js").then(module => ({ default: module.Design })));
const Departments = lazy(() => import("./Departments.js").then(module => ({ default: module.Departments })));
const Director = lazy(() => import("./Director.js").then(module => ({ default: module.Director })));
const Coordinator = lazy(() => import("./Coordinator.js").then(module => ({ default: module.Coordinator })));
const Operations = lazy(() => import("./Operations.js").then(module => ({ default: module.Operations })));
const Commercial = lazy(() => import("./Commercial.js").then(module => ({ default: module.Commercial })));
const Orders = lazy(() => import("./Orders.js").then(module => ({ default: module.Orders })));
const Boqs = lazy(() => import("./Boqs.js").then(module => ({ default: module.Boqs })));
const Team = lazy(() => import("./Team.js").then(module => ({ default: module.Team })));
const Masters = lazy(() => import("./Masters.js").then(module => ({ default: module.Masters })));

export function Dashboard({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [operationsIpoId, setOperationsIpoId] = useState<string>();
  const [pricingRevisionId, setPricingRevisionId] = useState<string>();
  const [revisionDraftId, setRevisionDraftId] = useState<string>();
  const [pricingRequestId, setPricingRequestId] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false);
  const [view, setView] = useState<
    | "dashboard"
    | "account"
    | "masters"
    | "team"
    | "boqs"
    | "pricing"
    | "quotes"
    | "operations"
    | "inventory"
    | "finance"
    | "design"
    | "orders"
  >("dashboard");
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      try {
        await api<{ user: User }>("/dashboard");
        if (!cancelled) {
          setVerified(true);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) onLogout();
        else
          setError(
            err instanceof Error ? err.message : "Unable to load workspace.",
          );
      }
    }
    void verify();
    const timer = setInterval(() => {
      void verify();
    }, 60000);
    window.addEventListener("focus", verify);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", verify);
    };
  }, [onLogout]);
  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Another tab may have changed the cookie/account since this page loaded.
      // Refresh only for logout; never retry a business action under another user.
      const current = await api<Session>("/auth/session");
      await api("/auth/logout", { body: {}, csrf: current.csrfToken });
      onLogout();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
      else
        setError(
          err instanceof Error
            ? err.message
            : "Unable to sign out. Please try again.",
        );
    } finally {
      setBusy(false);
    }
  }
  const [bucketTask, setBucketTask] = useState<any>();
  const initials = session.user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  function navigate(
    next:
      | "dashboard"
      | "account"
      | "masters"
      | "team"
      | "boqs"
      | "pricing"
      | "quotes"
      | "operations"
      | "inventory"
      | "finance"
      | "design"
      | "orders",
    task?: any,
  ) {
    setBucketTask(task);
    setView(next);
    setMobileOpen(false);
    setMenuOpen(false);
  }
  const Home = ["Admin", "Management"].includes(session.user.role)
    ? Director
    : Coordinator;
  return (
    <div className="workspace">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand compact />
          <button
            className="icon-button mobile-nav-toggle"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <Icon name="menu" />
          </button>
        </div>
        <div className="sidebar-navigation">
          <div className="nav-label">WORKSPACE</div>
          <nav aria-label="Main navigation">
            <button
              className={view === "dashboard" ? "nav-active" : ""}
              aria-current={view === "dashboard" ? "page" : undefined}
              onClick={() => navigate("dashboard")}
            >
              <Icon name="dashboard" />
              Dashboard
            </button>
            <button
              className={view === "account" ? "nav-active" : ""}
              aria-current={view === "account" ? "page" : undefined}
              onClick={() => navigate("account")}
            >
              <Icon name="account" />
              My account
            </button>
            {["Admin", "Management", "Coordinator"].includes(session.user.role) && (
              <button
                className={view === "masters" ? "nav-active" : ""}
                aria-current={view === "masters" ? "page" : undefined}
                onClick={() => navigate("masters")}
              >
                <Icon name="users" />
                Master data
              </button>
            )}
          </nav>
          {session.user.role === "Admin" && (
            <button
              className={view === "team" ? "nav-active" : ""}
              aria-current={view === "team" ? "page" : undefined}
              onClick={() => navigate("team")}
            >
              <Icon name="users" />
              Team access
            </button>
          )}
          <div className="nav-divider" />
          <div className="nav-label">PROJECT OPERATIONS</div>
          <div className="upcoming-nav" aria-label="Project workspaces">
            <div>
              <Icon name="users" />
              <span>Customers & sites</span>
              <small>Ready</small>
            </div>
            {["Admin", "Management", "Coordinator"].includes(session.user.role) && (
              <>
                <button
                  className={view === "boqs" ? "nav-active" : ""}
                  aria-current={view === "boqs" ? "page" : undefined}
                  onClick={() => navigate("boqs")}
                >
                  <Icon name="file" />
                  Survey & BOQ
                </button>
                <button
                  className={view === "pricing" ? "nav-active" : ""}
                  onClick={() => {
                    setPricingRevisionId(undefined);
                    navigate("pricing");
                  }}
                >
                  <Icon name="file" />
                  Commercial pricing
                </button>
                <button
                  className={view === "quotes" ? "nav-active" : ""}
                  onClick={() => navigate("quotes")}
                >
                  <Icon name="file" />
                  Quotations
                </button>
                <button
                  className={view === "orders" ? "nav-active" : ""}
                  onClick={() => navigate("orders")}
                >
                  <Icon name="file" />
                  Customer PO & IPO
                </button>
              </>
            )}
            {["Admin", "Management", "Design"].includes(session.user.role) && (
              <button
                className={view === "design" ? "nav-active" : ""}
                onClick={() => navigate("design")}
              >
                <Icon name="file" />
                Design workspace
              </button>
            )}
            {["Admin", "Management", "Coordinator", "Operations"].includes(session.user.role) && (
              <>
                <button
                  className={view === "operations" ? "nav-active" : ""}
                  onClick={() => {
                    setOperationsIpoId(undefined);
                    navigate("operations");
                  }}
                >
                  <Icon name="file" />
                  BOQ to Operations
                </button>
              </>
            )}
            {["Admin", "Management", "Inventory"].includes(
              session.user.role,
            ) && (
              <button
                className={view === "inventory" ? "nav-active" : ""}
                onClick={() => navigate("inventory")}
              >
                <Icon name="file" />
                Inventory workspace
              </button>
            )}
            {["Admin", "Management", "Accounts"].includes(
              session.user.role,
            ) && (
              <button
                className={view === "finance" ? "nav-active" : ""}
                onClick={() => navigate("finance")}
              >
                <Icon name="file" />
                Accounts workspace
              </button>
            )}
          </div>
          <p className="nav-hint">
            Modules become available after
            <br />
            each milestone is verified.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="version">POWER ZONE OPERATIONS · V2</span>
          <p>Engineering & Services</p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span aria-hidden="true">/</span>{" "}
            <strong>
              {view === "dashboard"
                ? "Dashboard"
                : view === "design"
                  ? "Design workspace"
                  : view === "masters"
                    ? "Master data"
                    : view === "team"
                      ? "Team access"
                      : view === "boqs"
                        ? "Survey & BOQ"
                        : view === "pricing"
                          ? "Commercial pricing"
                          : view === "quotes"
                            ? "Quotations"
                            : view === "operations"
                              ? "BOQ to Operations"
                              : view === "orders"
                                ? "Customer PO & IPO"
                                : view === "inventory"
                                  ? "Inventory workspace"
                                  : view === "finance"
                                    ? "Accounts workspace"
                                    : "My account"}
            </strong>
          </span>
          <div className="account">
            <button
              className="account-trigger"
              aria-expanded={menuOpen}
              aria-controls="account-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="avatar" aria-hidden="true">
                {initials}
              </span>
              <span>
                <strong>{session.user.displayName}</strong>
                <small>{session.user.role}</small>
              </span>
              <Icon name="chevron" />
            </button>
            {menuOpen && (
              <div className="account-menu" id="account-menu">
                <button onClick={() => navigate("account")}>
                  <Icon name="account" />
                  My account
                </button>
                <button onClick={logout} disabled={busy}>
                  <Icon name="logout" />
                  {busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="dashboard">
          <WorkspaceBoundary>
          <Suspense fallback={<p role="status" aria-live="polite">Opening workspace…</p>}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">POWER ZONE OPERATIONS</span>
              <h1>
                {view === "dashboard"
                  ? `Welcome, ${session.user.displayName}.`
                  : view === "design"
                    ? "Design workspace"
                    : view === "masters"
                      ? "Master data"
                      : view === "team"
                        ? "Team access"
                        : view === "boqs"
                          ? "Survey & BOQ"
                          : view === "pricing"
                            ? "Commercial pricing"
                            : view === "quotes"
                              ? "Quotations"
                              : view === "operations"
                                ? "Operations delivery portal"
                                : view === "orders"
                                  ? "Customer PO & IPO"
                                  : view === "inventory"
                                    ? "Inventory workspace"
                                    : view === "finance"
                                      ? "Accounts workspace"
                                      : "My account"}
              </h1>
              <p className="dashboard-intro">
                {view === "dashboard"
                  ? session.user.role === "Design"
                    ? "Prepare technical surveys and send them to Coordination."
                    : session.user.role === "Inventory"
                      ? "Prepare stock requirements and track Store dispatch work."
                      : session.user.role === "Accounts"
                        ? "Review IPOs and collect supporting documents for accounting."
                        : session.user.role === "Operations"
                          ? "Plan delivery and issue received BOQs to Store."
                          : ["Admin", "Management"].includes(session.user.role)
                            ? "Review approvals and track customer/site budgets."
                            : "Pending coordination work and recent completed activity."
                  : view === "design"
                    ? "Design workspace"
                    : view === "masters"
                      ? "Your customers, sites and approved reference data."
                      : view === "boqs"
                        ? "Turn survey information into a reviewed BOQ and project costing."
                        : view === "pricing"
                          ? "Set markup and selling price against an approved BOQ."
                          : view === "quotes"
                            ? "Prepare and share immutable customer quotation versions."
                            : view === "team"
                              ? "Invite and manage authorised team members."
                              : view === "operations"
                                ? "Send approved site requirements to Operations after IPO creation."
                                : view === "orders"
                                  ? "Turn an accepted quotation and customer PO into an internal purchase order."
                                  : view === "inventory"
                                    ? "Stock preparation and dispatch document queues."
                                    : view === "finance"
                                      ? "IPO review and supporting-document queues."
                                      : "Your identity and access to the Power Zone workspace."}
              </p>
            </div>
            <button className="dark-button" onClick={logout} disabled={busy}>
              <Icon name="logout" />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {(view === "design" ||
            (view === "dashboard" && session.user.role === "Design")) && (
            <Design session={session} />
          )}
          {(view === "inventory" ||
            (view === "dashboard" && session.user.role === "Inventory")) && (
            <Departments session={session} department="Inventory" />
          )}
          {(view === "finance" ||
            (view === "dashboard" && session.user.role === "Accounts")) && (
            <Departments session={session} department="Accounts" />
          )}
          {view === "dashboard" && session.user.role === "Employee" && (
            <section className="card"><h2>Department access required</h2><p>Your account is active. Ask your administrator to assign your department before starting a workflow.</p></section>
          )}
          {view === "dashboard" && session.user.role === "Operations" && (
            <Operations session={session} portal />
          )}
          {view === "dashboard" &&
            ["Admin", "Management", "Coordinator"].includes(session.user.role) && (
              <Home
                session={session}
                onOpen={(task) => {
                  if (task.draft_id) setRevisionDraftId(task.draft_id);
                  else setRevisionDraftId(undefined);
                  setPricingRevisionId(task.boq_revision_id ?? undefined);
                  setPricingRequestId(task.request_id ?? undefined);
                  setOperationsIpoId(task.ipo_id ?? undefined);
                  navigate(task.target, task);
                }}
              />
            )}
          {(view === "pricing" || view === "quotes") && (
            <Commercial
              key={view + String(pricingRevisionId) + String(pricingRequestId)}
              session={session}
              initialRevisionId={pricingRevisionId}
              initialRequestId={pricingRequestId}
              initialQuotationId={
                bucketTask?.kind === "Sale confirmation"
                  ? bucketTask.id
                  : undefined
              }
              initialPricingId={
                bucketTask?.kind === "Quotation" ? bucketTask.id : undefined
              }
              onRevisionPricing={(id, requestId) => {
                setPricingRevisionId(id);
                setPricingRequestId(requestId);
                navigate("pricing");
              }}
              section={view === "pricing" ? "pricing" : "quotes"}
              onRevisionDraft={(id) => {
                setRevisionDraftId(id);
                navigate("boqs");
              }}
            />
          )}
          {view === "boqs" && (
            <Boqs
              initialDraftId={revisionDraftId}
              onPricing={(id) => {
                setPricingRequestId(undefined);
                setPricingRevisionId(id);
                navigate("pricing");
              }}
              session={session}
              onLogout={onLogout}
            />
          )}
          {view === "orders" && (
            <Orders
              key={bucketTask?.ipo_id ?? bucketTask?.id ?? "orders"}
              initialIpoId={
                bucketTask?.kind === "Operations issuance"
                  ? bucketTask.ipo_id
                  : undefined
              }
              session={session}
              initialSubmissionId={
                bucketTask?.kind === "IPO evidence" ? bucketTask.id : undefined
              }
              initialQuotationId={
                bucketTask?.kind === "Sale confirmation"
                  ? bucketTask.id
                  : undefined
              }
              onOperations={(id) => {
                setOperationsIpoId(id);
                navigate("operations");
              }}
            />
          )}
          {view === "operations" && (
            <Operations session={session} initialIpoId={operationsIpoId} />
          )}
          {view === "team" && <Team session={session} onLogout={onLogout} />}
          {view === "masters" && (
            <Masters session={session} onLogout={onLogout} />
          )}
          {view === "account" && (
            <div
              className={`dashboard-grid ${view === "account" ? "account-view" : ""}`}
            >
              <section className="detail-panel">
                <div className="panel-heading">
                  <h2>Your account</h2>
                  <Icon name="account" />
                </div>
                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>{session.user.displayName}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{session.user.email}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>
                      <span className="role-badge">{session.user.role}</span>
                    </dd>
                  </div>
                </dl>
                <button
                  onClick={() => {
                    void api<{ message: string }>("/accounts/verify-email", {
                      body: {},
                      csrf: session.csrfToken,
                    })
                      .then((r) => setError(r.message))
                      .catch((e) => setError(e.message));
                  }}
                >
                  Verify my email
                </button>
              </section>
              <section className="detail-panel next-panel">
                <span className="eyebrow">ACCOUNT ACCESS</span>
                <h2>Your workspace, securely connected.</h2>
                <p>
                  Your account controls access and records your work under your
                  name.
                </p>
                <span className="muted-label">
                  Need help with access? Contact your administrator.
                </span>
              </section>
            </div>
          )}
          <footer className="dashboard-footer">
            Power Zone Operations <span>V2 · Team workspace</span>
          </footer>
                  </Suspense>
          </WorkspaceBoundary>
        </main>
      </div>
    </div>
  );
}
