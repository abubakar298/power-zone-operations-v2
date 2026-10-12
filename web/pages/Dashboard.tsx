import {UblWorkflow} from './UblWorkflow.js';
import {AccountsWorkspace} from './AccountsWorkspace.js';
import {InventoryWorkspace} from './InventoryWorkspace.js';
import {confirmLeaveWorkspace} from "../hooks/useUnsavedChanges.js";
import {Button} from "../ui/Button.js";
import {CoordinatorLibrary} from "./CoordinatorLibrary.js";
import {NotificationAdmin} from "../components/NotificationAdmin.js";
import {NotificationCenter} from "../components/NotificationCenter.js";
import { lazy, Suspense, useEffect, useState } from "react";
import { WorkspaceBoundary } from "../components/WorkspaceBoundary.js";
import { api, ApiError, type Session, type User } from "../api.js";
import { Brand } from "../components/Brand.js";
import { Icon } from "../components/Icon.js";
import { Departments } from "./Departments.js";

const Design = lazy(() => import("./Design.js").then(module => ({ default: module.Design })));
const Director = lazy(() => import("./Director.js").then(module => ({ default: module.Director })));
const Coordinator = lazy(() => import("./Coordinator.js").then(module => ({ default: module.Coordinator })));
const Operations = lazy(() => import("./Operations.js").then(module => ({ default: module.Operations })));
const CniProposals = lazy(() => import("./CniProposals.js").then(module => ({ default: module.CniProposals })));
const Commercial = lazy(() => import("./Commercial.js").then(module => ({ default: module.Commercial })));
const Orders = lazy(() => import("./Orders.js").then(module => ({ default: module.Orders })));
const Boqs = lazy(() => import("./Boqs.js").then(module => ({ default: module.Boqs })));
const Team = lazy(() => import("./Team.js").then(module => ({ default: module.Team })));
const UblConfigurations = lazy(() => import("./UblConfigurations.js").then(module=>({default:module.UblConfigurations})));
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
    | "ubl-workflow" | "ubl" | "projects" | "documents" | "newboq" | "customers" | "rates"
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
  const [projectContextKey,setProjectContextKey]=useState<string>(),[currentProjectKey,setCurrentProjectKey]=useState<string>();
  const [linkedDocumentId,setLinkedDocumentId]=useState<string>();
  const [origin, setOrigin] = useState("dashboard");
  const initials = session.user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  function navigate(
    next:
      | "ubl-workflow" | "ubl" | "projects" | "documents" | "newboq" | "customers" | "rates"
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
    if(!confirmLeaveWorkspace())return false;
    if (["dashboard","projects","documents"].includes(view)) setOrigin(view);
    if (next === "dashboard") window.dispatchEvent(new Event("pz:workspace-open"));
    setBucketTask(task);
    setView(next);
    window.history.replaceState(null,"",`/dashboard#workspace=${next}`);
    setMobileOpen(false);
    setMenuOpen(false);
    return true;
  }
  const isCoordinator = session.user.role === "Coordinator";
  const canUseLibrary=["Coordinator","Admin","Management"].includes(session.user.role);
  useEffect(()=>{
    function followHash(){
    const params=new URLSearchParams(window.location.hash.slice(1)),destination=params.get("workspace");
    if(destination==="ubl-workflow"&&["Admin","Management","Coordinator","Design","Operations","Accounts"].includes(session.user.role)){setView("ubl-workflow");return;}
    if(!canUseLibrary || !["dashboard","projects","documents","ubl"].includes(destination??""))return;
    setView(destination as "dashboard"|"projects"|"documents"|"ubl");
    const document=params.get("document");if(document&&/^[0-9a-f-]{36}$/i.test(document))setLinkedDocumentId(document);
    const project=params.get("project");if(project&&project.length<=500)setProjectContextKey(project);
    }
    followHash();window.addEventListener("hashchange",followHash);return()=>window.removeEventListener("hashchange",followHash);
  },[canUseLibrary]);
  useEffect(()=>{let alive=true;setCurrentProjectKey(undefined);if(!isCoordinator||!bucketTask)return;void api<any>('/coordinator/projects').then(index=>{const ids=[bucketTask.id,bucketTask.ipo_id,bucketTask.boq_revision_id,bucketTask.draft_id].filter(Boolean);const record=index.documents?.find((d:any)=>ids.includes(d.id)||ids.includes(d.proposal_id));if(alive)setCurrentProjectKey(record?.project_key)}).catch(()=>{});return()=>{alive=false}},[bucketTask,isCoordinator]);
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
          {isCoordinator ? <>
            <div className="nav-label">DAILY WORK</div>
            <nav aria-label="Main navigation">
              {([['dashboard','My Workspace','dashboard'],['projects','Projects','site'],['newboq','New BOQ','plus'],['documents','Documents','file'],['customers','Customers & Sites','users'],['rates','Rate Master','rates']] as const).map(([destination,label,icon])=>{
                const active=view===destination || (view==="ubl"&&destination==="customers") || (['boqs','pricing','quotes','orders','operations'].includes(view)&&origin===destination);
                return <button key={destination} className={active?'nav-active':''} aria-current={active?'page':undefined} onClick={()=>{if(!navigate(destination))return;setRevisionDraftId(undefined);setPricingRevisionId(undefined);setPricingRequestId(undefined);setOperationsIpoId(undefined);}}><Icon name={icon}/>{label}</button>;
              })}
            </nav>
          </> : <>

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
          {["Admin","Management","Coordinator","Design","Operations","Accounts"].includes(session.user.role)&&<button className={view==="ubl-workflow"?"nav-active":""} aria-current={view==="ubl-workflow"?"page":undefined} onClick={()=>navigate("ubl-workflow")}><Icon name="file"/><span>UBL Site Workflow</span></button>}
          <div className="nav-divider" />
          <div className="nav-label">PROJECT OPERATIONS</div>
          <div className="upcoming-nav" aria-label="Project workspaces">
            {["Admin","Management"].includes(session.user.role)&&<button className={view==="ubl"?"nav-active":""} aria-current={view==="ubl"?"page":undefined} onClick={()=>navigate("ubl")}><Icon name="file"/><span>UBL Solar</span></button>}
            <button className={view==="customers"?"nav-active":""} aria-current={view==="customers"?"page":undefined} onClick={()=>navigate("customers")}>
              <Icon name="users" />
              <span>Customers & Sites</span>
            </button>
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
          </>}
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
              {["projects","documents","newboq","customers","rates","ubl","ubl-workflow"].includes(view) ? ({projects:"Projects",documents:"Documents",newboq:"New BOQ",customers:"Customers & Sites",rates:"Rate Master",ubl:"UBL Solar","ubl-workflow":"UBL Site Workflow"} as Record<string,string>)[view] : view === "dashboard"
                ? isCoordinator ? "My Workspace" : "Dashboard"
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
          <NotificationCenter session={session} onOpen={task=>{if(!navigate(task.target,task))return;setPricingRevisionId(task.boq_revision_id??undefined);setPricingRequestId(task.request_id??undefined);setRevisionDraftId(task.draft_id??undefined);setOperationsIpoId(task.ipo_id??undefined);}} />
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
                {["projects","documents","newboq","customers","rates","ubl","ubl-workflow"].includes(view) ? ({projects:"Projects",documents:"Documents",newboq:"New BOQ",customers:"Customers & Sites",rates:"Rate Master",ubl:"UBL Solar","ubl-workflow":"UBL Site Workflow"} as Record<string,string>)[view] : view === "dashboard"
                  ? isCoordinator ? "My Workspace" : `Welcome, ${session.user.displayName}.`
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
                {["projects","documents","newboq","customers","rates","ubl","ubl-workflow"].includes(view) ? "Select the relevant customer, site or document to continue your work." : view === "dashboard"
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
                            : "Select a bucket or review all pending tasks."
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

          </div>
          {isCoordinator && ["boqs","pricing","quotes","orders","operations"].includes(view) && <Button variant="neutral" onClick={()=>navigate(origin as Parameters<typeof navigate>[0])}>← Back to {origin==="projects"?"Projects":origin==="documents"?"Documents":"My Workspace"}</Button>}
          {isCoordinator && currentProjectKey && ["boqs","pricing","quotes","orders","operations"].includes(view) && <Button variant="secondary" onClick={()=>{setProjectContextKey(currentProjectKey);navigate("projects")}}>View project</Button>}
          {canUseLibrary && <div hidden={view!=="projects"&&view!=="documents"}><CoordinatorLibrary initialDocumentId={linkedDocumentId} initialProjectKey={projectContextKey} active={view==="projects"||view==="documents"} mode={view==="projects"?"projects":"documents"} onOpen={task=>{setRevisionDraftId(task.draft_id);setPricingRevisionId(task.boq_revision_id);setPricingRequestId(task.request_id);setOperationsIpoId(task.ipo_id);navigate(task.target,task);}} /></div>}
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
            <InventoryWorkspace session={session} />
          )}
          {(view === "finance" ||
            (view === "dashboard" && session.user.role === "Accounts")) && (
            <AccountsWorkspace session={session} initialRecordId={bucketTask?.ipo_id} />
          )}
          {view === "dashboard" && session.user.role === "Employee" && (
            <section className="card"><h2>Department access required</h2><p>Your account is active. Ask your administrator to assign your department before starting a workflow.</p></section>
          )}
          {view === "dashboard" && session.user.role === "Operations" && (
            <Operations session={session} portal />
          )}
          {(view === "dashboard" || isCoordinator) &&
            ["Admin", "Management", "Coordinator"].includes(session.user.role) && (
            <div hidden={view!=="dashboard"}>
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
            </div>) }
          {(view === "pricing" || view === "quotes") && (bucketTask?.kind === "C&I proposal" ? <CniProposals reviewOnly session={session} masters={{customers:[]}} initialProposalId={bucketTask.id} onLogout={onLogout} onBack={()=>navigate(origin as Parameters<typeof navigate>[0])} /> : (
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
          ))}
          {(view === "boqs" || view === "newboq") && (
            <Boqs
              key={view+String(bucketTask?.id)+String(revisionDraftId)}
              startNew={view==="newboq"}
              initialContext={bucketTask?.context}
              initialBoqId={bucketTask?.kind==="Saved BOQ" ? bucketTask.id : undefined}
              initialDraftId={revisionDraftId}
              initialCniId={bucketTask?.kind === "C&I proposal" ? bucketTask.id : undefined}
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
          {view === "team" && <><Team session={session} onLogout={onLogout} />{session.user.role==="Admin"&&<NotificationAdmin session={session}/>}</>}
          {["masters","customers","rates"].includes(view) && (
            <Masters key={view} initialKind={view==="rates"?"rates":"customers"} allowedKinds={view==="customers"?["customers","sites"]:view==="rates"?["rates","items","brands","rules"]:undefined} session={session} onLogout={onLogout} onOpenUbl={['Admin','Management'].includes(session.user.role)?()=>navigate("ubl"):undefined} />
          )}
          {view === "ubl-workflow"&&<UblWorkflow session={session}/>}
          {view === "ubl"&&["Admin","Management"].includes(session.user.role)&&<UblConfigurations session={session} onBack={()=>navigate("customers")}/>}
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
