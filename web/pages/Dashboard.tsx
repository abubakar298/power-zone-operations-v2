import {UpsAlerts} from '../components/UpsAlerts.js';
import {ManagementApprovals} from "../components/ManagementApprovals.js";
import {UpsManagementPortfolio} from "../components/UpsManagementPortfolio.js";
import {DepartmentViewSwitcher} from "../components/DepartmentViewSwitcher.js";
import {canViewDepartments,managementDepartment,managementDepartments,type ManagementDepartment} from "../workspaces/management-departments.js";
import {savedDepartmentUser,saveDepartmentUser,clearDepartmentUser} from '../department-view.js';
import {SidebarBuckets} from "../components/SidebarBuckets.js";
import {
  bucketLabel,
  designBuckets as sharedDesignBuckets,
  coordinationBuckets as sharedCoordinationBuckets,
} from "../workspaces/project-routes.js";
import { UblWorkflow } from "./UblWorkflow.js";
import { AccountsWorkspace } from "./AccountsWorkspace.js";
import { InventoryWorkspace } from "./InventoryWorkspace.js";
import { confirmLeaveWorkspace } from "../hooks/useUnsavedChanges.js";
import { Button } from "../ui/Button.js";
import { CoordinatorLibrary } from "./CoordinatorLibrary.js";
import { NotificationAdmin } from "../components/NotificationAdmin.js";
import { NotificationCenter } from "../components/NotificationCenter.js";
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { WorkspaceBoundary } from "../components/WorkspaceBoundary.js";
import { api, ApiError, type Session, type User } from "../api.js";
import { Brand } from "../components/Brand.js";
import { Icon } from "../components/Icon.js";

const Design = lazy(() =>
  import("./Design.js").then((module) => ({ default: module.Design })),
);
const Departments = lazy(() =>
  import("./Departments.js").then((module) => ({
    default: module.Departments,
  })),
);
const Coordinator = lazy(() =>
  import("./Coordinator.js").then((module) => ({
    default: module.Coordinator,
  })),
);
const Operations = lazy(() =>
  import("./Operations.js").then((module) => ({ default: module.Operations })),
);
const CniProposals = lazy(() =>
  import("./CniProposals.js").then((module) => ({
    default: module.CniProposals,
  })),
);
const Commercial = lazy(() =>
  import("./Commercial.js").then((module) => ({ default: module.Commercial })),
);
const Orders = lazy(() =>
  import("./Orders.js").then((module) => ({ default: module.Orders })),
);
const Boqs = lazy(() =>
  import("./Boqs.js").then((module) => ({ default: module.Boqs })),
);
const Team = lazy(() =>
  import("./Team.js").then((module) => ({ default: module.Team })),
);
const UblConfigurations = lazy(() =>
  import("./UblConfigurations.js").then((module) => ({
    default: module.UblConfigurations,
  })),
);
const Masters = lazy(() =>
  import("./Masters.js").then((module) => ({ default: module.Masters })),
);

export function Dashboard({
  session: principalSession,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [departmentUser,setDepartmentUser]=useState<User|undefined>(()=>savedDepartmentUser(principalSession.user));
  const session=departmentUser?{...principalSession,user:departmentUser}:principalSession;
  const [switchingDepartment,setSwitchingDepartment]=useState(false),[departmentError,setDepartmentError]=useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [directPoEnabled,setDirectPoEnabled]=useState(false);
  useEffect(()=>{if(session.user.role==='Coordinator')void api<any>('/project-workflow/references').then(r=>setDirectPoEnabled(r.features?.directPoUps===true)).catch(()=>setDirectPoEnabled(false));},[session.user.id]);
  const [workspaceVisit, setWorkspaceVisit] = useState(0);
  const [departmentView,setDepartmentView]=useState<ManagementDepartment|undefined>(()=>managementDepartments.find(d=>d.role===departmentUser?.role)?.view);
  const [departmentPage, setDepartmentPage] = useState("Workspace");
  useLayoutEffect(() => {
    const active = (event: Event) => setDepartmentPage((event as CustomEvent<string>).detail);
    window.addEventListener("pz:department-active", active);
    return () => window.removeEventListener("pz:department-active", active);
  }, []);
  const [operationsIpoId, setOperationsIpoId] = useState<string>();
  const [pricingRevisionId, setPricingRevisionId] = useState<string>();
  const [revisionDraftId, setRevisionDraftId] = useState<string>();
  const [pricingRequestId, setPricingRequestId] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false);
  const [view, setView] = useState<
    | "ubl-workflow"
    | "ubl"
    | "ubl-ups"
    | "mbl-ups"
    | "alerts"
    | "bafl-solar"
    | "projects"
    | "documents"
    | "newboq"
    | "customers"
    | "rates"
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
    | "coordination"
    | "orders"
  >(()=>new URLSearchParams(window.location.search).has('pricingPreviewToken')?'pricing':'dashboard');
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
  const [projectContextKey, setProjectContextKey] = useState<string>(),
    [currentProjectKey, setCurrentProjectKey] = useState<string>();
  const [linkedDocumentId, setLinkedDocumentId] = useState<string>();
  const [origin, setOrigin] = useState("dashboard");
  const initials = session.user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  function navigate(
    next:
      | "ubl-workflow"
      | "ubl"
      | "ubl-ups"
      | "mbl-ups"
      | "alerts"
      | "bafl-solar"
      | "projects"
      | "documents"
      | "newboq"
      | "customers"
      | "rates"
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
      | "coordination"
      | "orders",
    task?: any,
    resetWorkspace = false,
    asDepartment = false,
  ) {
    if (!confirmLeaveWorkspace()) return false;
    const department=asDepartment&&canViewDepartments(session.user.role)?managementDepartment(next)?.view:undefined;
    if(!departmentUser)setDepartmentView(department);
    if(department){sessionStorage.removeItem('pz:department-page');sessionStorage.removeItem('pz:workflow-open');setDepartmentPage('Workspace');setWorkspaceVisit(visit=>visit+1);}
    if (["dashboard", "projects", "documents"].includes(view)) setOrigin(view);
    if (next === "dashboard" && resetWorkspace) {
      sessionStorage.removeItem("pz:department-page");
      sessionStorage.removeItem("pz:workflow-open");
      setWorkspaceVisit((visit) => visit + 1);
      setDepartmentPage("Workspace");
    }
    else if (next === "dashboard") window.dispatchEvent(new Event("pz:workspace-open"));
    setBucketTask(task);
    if (task?.workflow_id)
      sessionStorage.setItem("pz:workflow-open", task.workflow_id);
    setView(next);
    if(session.user.role==='Coordinator'&&(next==='boqs'||next==='newboq'))setDepartmentPage('Create Quotation');
    window.history.replaceState(null, "", `/dashboard#workspace=${next}${departmentUser?'&viewAs='+departmentUser.role:department?'&viewAs=department':''}`);
    setMobileOpen(false);
    setMenuOpen(false);
    return true;
  }
  async function selectDepartment(destination:ManagementDepartment|'dashboard'){
    if(switchingDepartment||!confirmLeaveWorkspace())return false;
    setSwitchingDepartment(true);setDepartmentError('');
    try{
      let selected:User|undefined;
      if(destination!=='dashboard'){
        const role=managementDepartment(destination)!.role;
        const {users}=await api<{users:User[]}>('/auth/department-views');
        const candidates=users.filter(u=>u.role===role);
        const preferred=role==='Coordinator'?'Atif Hameed':role==='Design'?'Sajid Kasrana':'';
        const target=candidates.find(u=>u.displayName.toLowerCase()===preferred.toLowerCase())??candidates[0];
        if(!target)throw Error(`No active ${managementDepartment(destination)!.label} account is available.`);
        selected=(await api<{user:User}>('/auth/department-view',{csrf:principalSession.csrfToken,body:{userId:target.id}})).user;
        saveDepartmentUser(principalSession.user,selected);
      }else{await api('/auth/department-view',{csrf:principalSession.csrfToken,body:{userId:null}});clearDepartmentUser();}
      setDepartmentUser(selected);setDepartmentView(destination==='dashboard'?undefined:destination);
      sessionStorage.removeItem('pz:department-page');sessionStorage.removeItem('pz:workflow-open');
      setBucketTask(undefined);setDepartmentPage('Workspace');setView('dashboard');setMenuOpen(false);setMobileOpen(false);
      setWorkspaceVisit(visit=>visit+1);
      window.history.replaceState(null,'',`/dashboard#workspace=dashboard${selected?'&viewAs='+selected.role:''}`);
      return true;
    }catch(e){setDepartmentError(e instanceof Error?e.message:'Unable to open department.');return false;}finally{setSwitchingDepartment(false);}
  }
  const isCoordinator = session.user.role === "Coordinator";
  const canUseLibrary = ["Coordinator", "Admin", "Management"].includes(
    session.user.role,
  );
  useEffect(() => {
    function followHash() {
      const params = new URLSearchParams(window.location.hash.slice(1)),
        destination = params.get("workspace");
      if(canViewDepartments(session.user.role)&&managementDepartment(destination)){
        setView(destination as ManagementDepartment);
        setDepartmentView(params.get('viewAs')==='department'?destination as ManagementDepartment:undefined);
        return;
      }
      if(!departmentUser)setDepartmentView(undefined);
      if(destination === "alerts" && ["Admin","Management","Operations","Accounts"].includes(session.user.role)){setView("alerts");return;}
      if (
        destination === "masters" && ["Admin", "Management", "Coordinator"].includes(session.user.role)
      ) { setView("masters"); return; }
      if (
        ["ubl-ups", "mbl-ups", "bafl-solar"].includes(destination ?? "") &&
        ["Admin", "Management"].includes(session.user.role)
      ) {
        setView(destination as "ubl-ups" | "mbl-ups" | "bafl-solar");
        return;
      }
      if (
        destination === "ubl-workflow" &&
        [
          "Admin",
          "Management",
          "Coordinator",
          "Design",
          "Operations",
          "Accounts",
        ].includes(session.user.role)
      ) {
        setView("ubl-workflow");
        return;
      }
      if (
        !canUseLibrary ||
        !["dashboard", "projects", "documents", "ubl"].includes(
          destination ?? "",
        )
      )
        return;
      setView(destination as "dashboard" | "projects" | "documents" | "ubl");
      const document = params.get("document");
      if (document && /^[0-9a-f-]{36}$/i.test(document))
        setLinkedDocumentId(document);
      const project = params.get("project");
      if (project && project.length <= 500) setProjectContextKey(project);
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [canUseLibrary]);
  useEffect(() => {
    let alive = true;
    setCurrentProjectKey(undefined);
    if (!isCoordinator || !bucketTask) return;
    void api<any>("/coordinator/projects")
      .then((index) => {
        const ids = [
          bucketTask.id,
          bucketTask.ipo_id,
          bucketTask.boq_revision_id,
          bucketTask.draft_id,
        ].filter(Boolean);
        const record = index.documents?.find(
          (d: any) => ids.includes(d.id) || ids.includes(d.proposal_id),
        );
        if (alive) setCurrentProjectKey(record?.project_key);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bucketTask, isCoordinator]);
  const managementHome = view === "dashboard" && canViewDepartments(session.user.role);
  return (
    <div className={`workspace fixed-header-layout ${session.user.role === "Coordinator" ? "coordinator-layout" : ""}`}>
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
          {["Admin", "Management"].includes(session.user.role) ? (
            <nav aria-label="Customer workspaces">
              {([
                ["ubl", "UBL Solar"],
                ["ubl-ups", "UBL UPS"],
                ["mbl-ups", "MBL UPS"],
                ["bafl-solar", "BAFL Solar"],
                ["alerts", "Alerts"],
              ] as const).map(([destination, label]) => (
                <button key={destination}
                  className={view === destination ? "nav-active" : ""}
                  aria-current={view === destination ? "page" : undefined}
                  onClick={() => navigate(destination)}>
                  <Icon name="file" /><span>{label}</span>
                </button>
              ))}
            </nav>
          ) : ["Coordinator", "Design"].includes(session.user.role) ? (
            <>
              <div className="nav-label">DAILY WORK</div>
              <nav aria-label="Main navigation">
                <button
                  className={view === "dashboard" && departmentPage === "Workspace" ? "nav-active" : ""}
                  aria-current={view === "dashboard" && departmentPage === "Workspace" ? "page" : undefined}
                  onClick={() => navigate("dashboard", undefined, true)}
                >
                  <Icon name="dashboard" />
                  Workspace
                </button>
                <SidebarBuckets department={session.user.role === 'Design' ? 'design' : 'coordination'} page={view === 'dashboard' ? departmentPage : ''} onSelect={bucket=>{if(navigate('dashboard')){sessionStorage.setItem('pz:department-page',bucket);window.dispatchEvent(new CustomEvent('pz:department-page',{detail:bucket}));}}}/>
                {session.user.role === "Coordinator" && (
                  <button className={view === "masters" ? "nav-active" : ""}
                    aria-current={view === "masters" ? "page" : undefined}
                    onClick={() => navigate("masters")}>
                    <span className="sidebar-bucket-label">Databases</span>
                  </button>
                )}
                {session.user.role === "Design" && <>
                <button
                  onClick={() => {
                    if (navigate("dashboard")) {
                      sessionStorage.setItem(
                        "pz:department-page",
                        session.user.role === "Design"
                          ? "Survey History"
                          : "Customer & Site Search",
                      );
                      window.dispatchEvent(
                        new CustomEvent("pz:department-page", {
                          detail:
                            session.user.role === "Design"
                              ? "Survey History"
                              : "Customer & Site Search",
                        }),
                      );
                    }
                  }}
                >
                  {session.user.role === "Design"
                    ? "Survey History"
                    : "Customer & Site Search"}
                </button>
                <button
                  onClick={() => {
                    if (navigate("dashboard")) {
                      sessionStorage.setItem(
                        "pz:department-page",
                        "Performance",
                      );
                      window.dispatchEvent(
                        new CustomEvent("pz:department-page", {
                          detail: "Performance",
                        }),
                      );
                    }
                  }}
                >
                  Performance
                </button>
                </>}
              </nav>
            </>
          ) : (
            <>
              <div className="nav-label">WORKSPACE</div>
              <nav aria-label="Main navigation">
                <button
                  className={view === "dashboard" ? "nav-active" : ""}
                  aria-current={view === "dashboard" ? "page" : undefined}
                  onClick={() => navigate("dashboard", undefined, true)}
                >
                  <Icon name="dashboard" />
                  Dashboard
                </button>
                {["Operations","Accounts"].includes(session.user.role) && <button className={view === "alerts" ? "nav-active" : ""} aria-current={view === "alerts" ? "page" : undefined} onClick={()=>navigate("alerts")}><Icon name="file"/><span>Alerts</span></button>}

                {["Admin", "Management", "Coordinator"].includes(
                  session.user.role,
                ) && (
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
              {["Admin", "Management"].includes(session.user.role) && (
                <button onClick={() => navigate("coordination")}>
                  Project Coordination
                </button>
              )}
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
              {[
                "Admin",
                "Management",
                "Coordinator",
                "Design",
                "Operations",
                "Accounts",
              ].includes(session.user.role) && (
                <button
                  className={view === "ubl-workflow" ? "nav-active" : ""}
                  aria-current={view === "ubl-workflow" ? "page" : undefined}
                  onClick={() => navigate("ubl-workflow")}
                >
                  <Icon name="file" />
                  <span>UBL Site Workflow</span>
                </button>
              )}
              <div className="nav-divider" />
              <div className="nav-label">PROJECT OPERATIONS</div>
              <div className="upcoming-nav" aria-label="Project workspaces">
                {["Admin", "Management"].includes(session.user.role) && (
                  <button
                    className={view === "ubl" ? "nav-active" : ""}
                    aria-current={view === "ubl" ? "page" : undefined}
                    onClick={() => navigate("ubl")}
                  >
                    <Icon name="file" />
                    <span>UBL Solar</span>
                  </button>
                )}
                <button
                  className={view === "customers" ? "nav-active" : ""}
                  aria-current={view === "customers" ? "page" : undefined}
                  onClick={() => navigate("customers")}
                >
                  <Icon name="users" />
                  <span>Customers & Sites</span>
                </button>
                {["Admin", "Management", "Coordinator"].includes(
                  session.user.role,
                ) && (
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
                {["Admin", "Management", "Design"].includes(
                  session.user.role,
                ) && (
                  <button
                    className={view === "design" ? "nav-active" : ""}
                    onClick={() => navigate("design")}
                  >
                    <Icon name="file" />
                    Design workspace
                  </button>
                )}
                {["Admin", "Management", "Coordinator", "Operations"].includes(
                  session.user.role,
                ) && (
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
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="version">POWER ZONE OPERATIONS · V2</span>
          <p>Engineering & Services</p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          {<>
            <Button variant="neutral" className="pz-header-brand" aria-label="Power Zone — Workspace" onClick={() => navigate("dashboard", undefined, true)}><Brand compact /></Button>
            <button className="icon-button mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Icon name="menu" /></button>
          </>}
          <span className="breadcrumb">
            Workspace <span aria-hidden="true">/</span>{" "}
            <strong>
              {[
                "projects",
                "documents",
                "newboq",
                "customers",
                "rates",
                "ubl",
                "ubl-ups",
                "mbl-ups",
                "bafl-solar",
                "alerts",
                "ubl-workflow",
              ].includes(view)
                ? (
                    {
                      projects: "Projects",
                      documents: "Documents",
                      newboq: session.user.role === "Coordinator" ? "Create Quotation" : "New BOQ",
                      customers: "Customers & Sites",
                      rates: "Rate Master",
                      ubl: "UBL Solar",
                      "ubl-ups": "UBL UPS",
                      "mbl-ups": "MBL UPS",
                      "bafl-solar": "BAFL Solar",
                      alerts: "Alerts",
                      "ubl-workflow": "UBL Site Workflow",
                    } as Record<string, string>
                  )[view]
                : view === "coordination"
                  ? "Project Coordination workspace"
                : view === "dashboard"
                  ? ["Coordinator", "Design"].includes(session.user.role)
                    ? bucketLabel(departmentPage)
                    : "Dashboard"
                  : view === "design"
                    ? "Design workspace"
                    : view === "masters"
                      ? session.user.role === "Coordinator" ? "Databases" : "Master data"
                      : view === "team"
                        ? "Team access"
                        : (view === "boqs" || view === "newboq")
                          ? session.user.role === "Coordinator" ? "Create Quotation" : "Survey & BOQ"
                          : view === "pricing"
                            ? session.user.role === "Coordinator" ? "Quotation Settings" : "Commercial pricing"
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
          {session.user.role === "Coordinator" && <nav className="coordinator-shortcuts" aria-label="Atif shortcuts">
            <Button variant="neutral" aria-current={view === "newboq" ? "page" : undefined} onClick={() => { if (navigate("newboq")) setRevisionDraftId(undefined); }}>Create Quotation</Button>
            {directPoEnabled&&<Button variant="neutral" aria-current={view==='dashboard'&&departmentPage==='Direct PO'?'page':undefined} onClick={()=>{if(navigate('dashboard')){sessionStorage.setItem('pz:department-page','Direct PO');window.dispatchEvent(new CustomEvent('pz:department-page',{detail:'Direct PO'}));}}}>Direct PO</Button>}
            <Button variant="neutral" aria-current={view === "dashboard" && departmentPage === "Customer & Site Search" ? "page" : undefined} onClick={() => { if (navigate("dashboard")) { sessionStorage.setItem("pz:department-page", "Customer & Site Search"); window.dispatchEvent(new CustomEvent("pz:department-page", {detail: "Customer & Site Search"})); } }}>Customer & Site Search</Button>
            <Button variant="neutral" aria-current={view === "dashboard" && departmentPage === "Performance" ? "page" : undefined} onClick={() => { if (navigate("dashboard")) { sessionStorage.setItem("pz:department-page", "Performance"); window.dispatchEvent(new CustomEvent("pz:department-page", {detail: "Performance"})); } }}>My Performance</Button>
          </nav>}
          <NotificationCenter
            session={session}
            onOpen={(task) => {
              if (!navigate(task.target, task)) return;
              setPricingRevisionId(task.boq_revision_id ?? undefined);
              setPricingRequestId(task.request_id ?? undefined);
              setRevisionDraftId(task.draft_id ?? undefined);
              setOperationsIpoId(task.ipo_id ?? undefined);
            }}
          />
          <DepartmentViewSwitcher role={principalSession.user.role} value={departmentView} busy={switchingDepartment} error={departmentError} onSelect={selectDepartment}/>
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
                {departmentUser?<button onClick={()=>void selectDepartment('dashboard')}>Return to Management</button>:<>
                <button onClick={() => navigate("account")}>
                  <Icon name="account" />
                  My account
                </button>
                <button
                  onClick={() => {
                    navigate("account");
                    window.dispatchEvent(new Event("pz:change-password"));
                  }}
                >
                  Change Password
                </button>
                </>}
                <button onClick={logout} disabled={busy}>
                  <Icon name="logout" />
                  {busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="dashboard" aria-label={managementHome ? "Management landing page" : undefined}>
          <WorkspaceBoundary key={workspaceVisit}>
            <Suspense
              fallback={
                <p role="status" aria-live="polite">
                  Opening workspace…
                </p>
              }
            >
              <div className="page-heading">
                <div>
                  <span className="eyebrow">POWER ZONE OPERATIONS</span>
                  <h1>
                    {[
                      "projects",
                      "documents",
                      "newboq",
                      "customers",
                      "rates",
                      "ubl",
                "ubl-ups",
                "mbl-ups",
                "bafl-solar",
                "alerts",
                      "ubl-workflow",
                    ].includes(view)
                      ? (
                          {
                            projects: "Projects",
                            documents: "Documents",
                            newboq: session.user.role === "Coordinator" ? "Create Quotation" : "New BOQ",
                            customers: "Customers & Sites",
                            rates: "Rate Master",
                            ubl: "UBL Solar",
                      "ubl-ups": "UBL UPS",
                      "mbl-ups": "MBL UPS",
                      "bafl-solar": "BAFL Solar",
                      alerts: "Alerts",
                            "ubl-workflow": "UBL Site Workflow",
                          } as Record<string, string>
                        )[view]
                      : view === "coordination"
                        ? "Project Coordination workspace"
                      : view === "dashboard"
                        ? ["Coordinator", "Design"].includes(session.user.role)
                          ? bucketLabel(departmentPage)
                          : `Welcome, ${session.user.displayName}.`
                        : view === "design"
                          ? "Design workspace"
                          : view === "masters"
                            ? session.user.role === "Coordinator" ? "Databases" : "Master data"
                            : view === "team"
                              ? "Team access"
                              : (view === "boqs" || view === "newboq")
                                ? session.user.role === "Coordinator" ? "Create Quotation" : "Survey & BOQ"
                                : view === "pricing"
                                  ? session.user.role === "Coordinator" ? "Quotation Settings" : "Commercial pricing"
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
                    {[
                      "projects",
                      "documents",
                      "newboq",
                      "customers",
                      "rates",
                      "ubl",
                "ubl-ups",
                "mbl-ups",
                "bafl-solar",
                "alerts",
                      "ubl-workflow",
                    ].includes(view)
                      ? view === "alerts" ? "Review sites awaiting action." : "Select the relevant customer, site or document to continue your work."
                      : view === "dashboard"
                        ? session.user.role === "Design"
                          ? "Prepare technical surveys and send them to Coordination."
                          : session.user.role === "Inventory"
                            ? "Prepare stock requirements and track Store dispatch work."
                            : session.user.role === "Accounts"
                              ? "Review IPOs and collect supporting documents for accounting."
                              : session.user.role === "Operations"
                                ? "Plan delivery and issue received BOQs to Store."
                                : ["Admin", "Management"].includes(
                                      session.user.role,
                                    )
                                  ? "Review documents awaiting your approval."
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
              {["Coordinator", "Design"].includes(session.user.role) &&
                view !== "dashboard" && (
                  <Button
                    variant="neutral"
                    onClick={() =>
                      navigate(origin as Parameters<typeof navigate>[0])
                    }
                  >
                    ← Back to{" "}
                    {origin === "projects"
                      ? "Projects"
                      : origin === "documents"
                        ? "Documents"
                        : "My Workspace"}
                  </Button>
                )}
              {isCoordinator &&
                currentProjectKey &&
                ["boqs", "pricing", "quotes", "orders", "operations"].includes(
                  view,
                ) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setProjectContextKey(currentProjectKey);
                      navigate("projects");
                    }}
                  >
                    View project
                  </Button>
                )}
              {canUseLibrary && (
                <div hidden={view !== "projects" && view !== "documents"}>
                  <CoordinatorLibrary
                    initialDocumentId={linkedDocumentId}
                    initialProjectKey={projectContextKey}
                    active={view === "projects" || view === "documents"}
                    mode={view === "projects" ? "projects" : "documents"}
                    onOpen={(task) => {
                      setRevisionDraftId(task.draft_id);
                      setPricingRevisionId(task.boq_revision_id);
                      setPricingRequestId(task.request_id);
                      setOperationsIpoId(task.ipo_id);
                      navigate(task.target, task);
                    }}
                  />
                </div>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {(view === "design" ||
                (view === "dashboard" && session.user.role === "Design")) && (
                <Design session={session} />
              )}
              {view === "coordination" && (
                <Coordinator
                  session={session}
                  onOpen={(task) => {
                    setPricingRevisionId(task.boq_revision_id);
                    setRevisionDraftId(task.draft_id);
                    navigate(task.target, task);
                  }}
                />
              )}
              {(view === "inventory" ||
                (view === "dashboard" &&
                  session.user.role === "Inventory")) && (
                <InventoryWorkspace session={session} />
              )}
              {(view === "finance" ||
                (view === "dashboard" && session.user.role === "Accounts")) && (
                <AccountsWorkspace
                  session={session}
                  initialRecordId={bucketTask?.ipo_id}
                />
              )}
              {view === "dashboard" && session.user.role === "Employee" && (
                <section className="card">
                  <h2>Department access required</h2>
                  <p>
                    Your account is active. Ask your administrator to assign
                    your department before starting a workflow.
                  </p>
                </section>
              )}
              {view === "dashboard" && session.user.role === "Operations" && (
                <Operations session={session} portal />
              )}
              {managementHome && <ManagementApprovals session={session} onOpen={(task)=>{
                setRevisionDraftId(task.draft_id);
                setPricingRevisionId(task.boq_revision_id);
                setPricingRequestId(task.request_id);
                navigate(task.target,task);
              }}/>}
              {isCoordinator && (
                  <div hidden={view !== "dashboard"}>
                    <Coordinator
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
                  </div>
                )}
              {(view === "pricing" || view === "quotes") &&
                (bucketTask?.kind === "C&I proposal" ? (
                  <CniProposals
                    followupPreview={Boolean(bucketTask.followupPreview)}
                    reviewOnly
                    session={session}
                    masters={{ customers: [] }}
                    initialProposalId={bucketTask.id}
                    onLogout={onLogout}
                    onBack={() =>
                      navigate(origin as Parameters<typeof navigate>[0])
                    }
                  />
                ) : (
                  <Commercial
                    key={
                      view +
                      String(pricingRevisionId) +
                      String(pricingRequestId)
                    }
                    session={session}
                    onQuotationSent={session.user.role==='Coordinator'?()=>{setBucketTask(undefined);setRevisionDraftId(undefined);setPricingRevisionId(undefined);setPricingRequestId(undefined);const url=new URL(window.location.href);url.searchParams.delete('pricingPreviewToken');url.hash='workspace=newboq';window.history.replaceState(null,'',url);setView('newboq');}:undefined}
                    initialRevisionId={pricingRevisionId}
                    initialFrameworkInput={bucketTask?.context?.frameworkPricingInput}
                    initialRequestId={pricingRequestId}
                    initialQuotationId={
                      bucketTask?.kind === "Sale confirmation"
                        ? bucketTask.id
                        : undefined
                    }
                    initialPricingId={
                      bucketTask?.kind === "Quotation"
                        ? bucketTask.id
                        : undefined
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
                  key={view + String(bucketTask?.id) + String(revisionDraftId)}
                  startNew={view === "newboq"}
                  initialContext={bucketTask?.context}
                  initialBoqId={
                    bucketTask?.kind === "Saved BOQ" ? bucketTask.id : undefined
                  }
                  initialDraftId={revisionDraftId}
                  initialCniId={
                    bucketTask?.kind === "C&I proposal"
                      ? bucketTask.id
                      : undefined
                  }
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
                    bucketTask?.kind === "IPO evidence"
                      ? bucketTask.id
                      : undefined
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
                <Operations session={session} initialIpoId={operationsIpoId} portal={departmentView==='operations'} />
              )}
              {view === "team" && (
                <>
                  <Team session={session} onLogout={onLogout} />
                  {session.user.role === "Admin" && (
                    <NotificationAdmin session={session} />
                  )}
                </>
              )}
              {["masters", "customers", "rates"].includes(view) && (
                <Masters
                  key={view}
                  initialKind={view === "rates" ? "rates" : "customers"}
                  allowedKinds={
                    view === "customers"
                      ? ["customers", "sites"]
                      : view === "rates"
                        ? ["rates", "items", "brands", "rules"]
                        : session.user.role === "Coordinator" ? ["customers"] : undefined
                  }
                  session={session}
                  onLogout={onLogout}
                  onOpenUbl={
                    ["Admin", "Management"].includes(session.user.role)
                      ? () => navigate("ubl")
                      : undefined
                  }
                />
              )}
              {view === "alerts" && ["Admin","Management","Operations","Accounts"].includes(session.user.role) && <UpsAlerts/>}
              {view === "ubl-workflow" && <UblWorkflow session={session} />}
              {view === "ubl" &&
                ["Admin", "Management"].includes(session.user.role) && (
                  <UblConfigurations
                    session={session}
                    onBack={() => navigate("customers")}
                  />
                )}
              {["mbl-ups","ubl-ups"].includes(view) && ["Admin", "Management"].includes(session.user.role) && <UpsManagementPortfolio key={view} customer={view === "mbl-ups" ? "MBL" : "UBL"}/>}
              {view === "bafl-solar" &&
                ["Admin", "Management"].includes(session.user.role) && (
                  <section className="detail-panel" aria-label="Workspace setup">
                    <p>This workspace is ready for you to define its layout and contents.</p>
                  </section>
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
                          <span className="role-badge">
                            {session.user.role}
                          </span>
                        </dd>
                      </div>
                    </dl>
                    <button
                      onClick={() => {
                        void api<{ message: string }>(
                          "/accounts/verify-email",
                          {
                            body: {},
                            csrf: session.csrfToken,
                          },
                        )
                          .then((r) => setError(r.message))
                          .catch((e) => setError(e.message));
                      }}
                    >
                      Verify my email
                    </button>
                  </section>
                  <section className="detail-panel next-panel">
                    <h2>Change password</h2>
                    <PasswordChange session={session} onChanged={onLogout} />
                    <span className="eyebrow">ACCOUNT ACCESS</span>
                    <h2>Your workspace, securely connected.</h2>
                    <p>
                      Your account controls access and records your work under
                      your name.
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

function PasswordChange({
  session,
  onChanged,
}: {
  session: Session;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        if (f.get("newPassword") !== f.get("confirmPassword")) {
          setError("The new passwords must match.");
          return;
        }
        setBusy(true);
        try {
          await api("/auth/change-password", {
            body: {
              currentPassword: f.get("currentPassword"),
              newPassword: f.get("newPassword"),
            },
            csrf: session.csrfToken,
          });
          onChanged();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Current password
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        New password
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <label>
        Confirm new password
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <p>Changing your password signs out your existing sessions.</p>
      <Button type="submit" loading={busy}>
        Change password
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
