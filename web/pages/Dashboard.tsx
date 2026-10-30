import {staffNavigationIcon} from '../components/staff-navigation-icons.js';
import {ProgrammeDashboard} from '../components/ProgrammeDashboard.js';
import {AccountsBilling} from './AccountsBilling.js';
import {accountsPageName} from '../../shared/accounts-navigation.js';
import {notificationPath} from '../../shared/notification-target.js';
import {UpsAlerts} from '../components/UpsAlerts.js';
import {ManagementDashboard} from "../components/ManagementDashboard.js";
import {UpsManagementPortfolio} from "../components/UpsManagementPortfolio.js";
import {DepartmentViewSwitcher} from "../components/DepartmentViewSwitcher.js";
import {OperationsAreaSwitcher,ProcurementWorkspace,type OperationsArea} from "../components/OperationsAreaSwitcher.js";
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
import { GlobalSearch } from "../components/GlobalSearch.js";
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
const SiteBoard = lazy(() =>
  import("./site-workflow/SiteBoard.js").then((module) => ({ default: module.SiteBoard })),
);
const OperationsRoleGate = lazy(() =>
  import("./procurement/OperationsWorkspaceGate.js").then((module) => ({ default: module.OperationsWorkspaceGate })),
);
const StoreStock = lazy(() =>
  import("./procurement/InventoryStoreStock.js").then((module) => ({ default: module.InventoryStoreStock })),
);
const PurchaseApprovals = lazy(() =>
  import("./procurement/PurchaseApprovals.js").then((module) => ({ default: module.PurchaseApprovals })),
);
const ProcurementAccess = lazy(() =>
  import("./security/ProcurementAccess.js").then((module) => ({ default: module.ProcurementAccess })),
);
const SecurityLog = lazy(() =>
  import("./security/SecurityLog.js").then((module) => ({ default: module.SecurityLog })),
);
const StockWatch = lazy(() =>
  import("./procurement/StockWatch.js").then((module) => ({ default: module.StockWatch })),
);
const OperationsHome = lazy(() =>
  import("./site-workflow/OperationsHome.js").then((module) => ({ default: module.OperationsHome })),
);
const SiteReport = lazy(() =>
  import("./site-workflow/SiteReport.js").then((module) => ({ default: module.SiteReport })),
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

const CurrentProcurementShell = lazy(() => import("./procurement/ProcurementShell.js").then(m => ({default:m.ProcurementShell})));

function currentOperationsArea(user:User):OperationsArea {
  const area=new URLSearchParams(window.location.hash.slice(1)).get('operationsArea');
  if(area==='procurement'||area==='operations')return area;
  return user.role==='Operations'&&user.displayName.toLowerCase()==='hamza mir'?'procurement':'operations';
}

export function Dashboard({
  session: principalSession,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [departmentUser,setDepartmentUser]=useState<User|undefined>(()=>savedDepartmentUser(principalSession.user));
  const [managementProcurement,setManagementProcurement]=useState(()=>canViewDepartments(principalSession.user.role)&&sessionStorage.getItem("pz:management-procurement")===principalSession.user.id);
  const session=departmentUser?{...principalSession,user:departmentUser}:principalSession;
  const [operationsArea,setOperationsArea]=useState<OperationsArea>(()=>currentOperationsArea(session.user));
  const [accountsPage,setAccountsPage]=useState(()=>accountsPageName(new URLSearchParams(location.hash.slice(1)).get('accountsTab')||({'/accounts/programmes':'Programme Dashboard','/accounts/sites':'Project Sites','/accounts/ipos':'IPOs Received','/accounts/inventory':'Approved Documents','/accounts/closures':'Job Closure','/accounts/closure-review':'Awaiting Management','/accounts/documents':'Physical Documents','/accounts/invoicing':'Invoicing','/accounts/receivables':'Receivables','/accounts/checkpoints':'Project checkpoints'} as Record<string,string>)[location.pathname]||'My Workspace'));
  const [accountsContext,setAccountsContext]=useState<string|null>(null);
  const [inventoryDispatcher,setInventoryDispatcher]=useState(false);
  useEffect(()=>{let live=true;if(session.user.role==='Inventory')void api<{kind:string}>('/material-dispatches/access').then(a=>{if(live)setInventoryDispatcher(a.kind==='dispatcher');}).catch(()=>{if(live)setInventoryDispatcher(false);});else setInventoryDispatcher(false);return()=>{live=false;};},[session.user.id,session.user.role]);
  function openAccountsPage(page:string){if(!navigate('finance'))return;setAccountsPage(page);setWorkspaceVisit(n=>n+1);const hash=new URLSearchParams(location.hash.slice(1));hash.set('accountsTab',page);history.replaceState(null,'',location.pathname+location.search+'#'+hash.toString());}

  useEffect(()=>{
    const sync=()=>setOperationsArea(currentOperationsArea(session.user));
    sync();window.addEventListener('hashchange',sync);
    return()=>window.removeEventListener('hashchange',sync);
  },[session.user.id]);
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
  const [siteToOpen, setSiteToOpen] = useState<string>();
  const [siteOpenNonce, setSiteOpenNonce] = useState(0);
  const [stageToOpen, setStageToOpen] = useState<string>();
  const [advanceToOpen, setAdvanceToOpen] = useState<string>();
  const [advanceOpenNonce, setAdvanceOpenNonce] = useState(0);
  const openSiteFromAnywhere = (id: string) => { setSiteToOpen(id); setSiteOpenNonce((n) => n + 1); setStageToOpen(undefined); navigate("sites"); };
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
    | "sites"
    | "sites-new"
    | "sites-ongoing"
    | "sites-completed"
    | "sites-docs"
    | "purchase-approvals"
    | "purchase-requests"
    | "procurement-access"
    | "security-log"
    | "stock-watch"
    | "stock-count"
    | "reports"
    | "inventory"
    | "project-tracking"
    | "receivables"
    | "finance"
    | "design"
    | "coordination"
    | "orders"
  >(()=>new URLSearchParams(window.location.search).has('pricingPreviewToken')?'pricing':/^\/accounts\/(ipos|inventory|documents|closures|closure-review|invoicing|programmes)$/.test(window.location.pathname)&&['Admin','Management','Accounts'].includes(session.user.role)?'finance':'dashboard');
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
      | "sites"
      | "sites-new"
      | "sites-ongoing"
      | "sites-completed"
      | "sites-docs"
      | "purchase-approvals"
      | "purchase-requests"
      | "procurement-access"
      | "security-log"
      | "stock-watch"
      | "stock-count"
      | "reports"
      | "inventory"
      | "project-tracking"
    | "receivables"
    | "finance"
      | "design"
      | "coordination"
      | "orders",
    task?: any,
    resetWorkspace = false,
    asDepartment = false,
  ) {
    if (!confirmLeaveWorkspace()) return false;
    if(next==='inventory'&&['Admin','Management','Inventory'].includes(principalSession.user.role)){clearDepartmentUser();location.assign('/inventory');return true;}
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
  function selectOperationsArea(area:OperationsArea){
    if(canViewDepartments(principalSession.user.role)){
      void selectDepartment('operations',area);
      return;
    }
    if(!navigate('dashboard'))return;
    setOperationsArea(area);setOperationsIpoId(undefined);
    const params=new URLSearchParams(window.location.hash.slice(1));
    params.set('operationsArea',area);
    window.history.replaceState(null,'',`/dashboard#${params}`);
  }
  async function selectDepartment(destination:ManagementDepartment|'dashboard',area:OperationsArea='operations'){
    if(switchingDepartment||!confirmLeaveWorkspace())return false;
    setSwitchingDepartment(true);setDepartmentError('');
    try{
      if(destination==='operations'&&area==='procurement'){
        await api('/auth/department-view',{csrf:principalSession.csrfToken,body:{userId:null}});
        clearDepartmentUser();setDepartmentUser(undefined);
        sessionStorage.setItem('pz:management-procurement',principalSession.user.id);setManagementProcurement(true);
        history.replaceState(null,'','/dashboard#workspace=dashboard');return true;
      }
      sessionStorage.removeItem('pz:management-procurement');setManagementProcurement(false);
      if(destination==='inventory'){clearDepartmentUser();window.location.assign('/inventory');return true;}
      let selected:User|undefined;
      if(destination!=='dashboard'){
        const role=managementDepartment(destination)!.role;
        const {users}=await api<{users:User[]}>('/auth/department-views');
        const candidates=users.filter(u=>u.role===role);
        const preferred=role==='Coordinator'?'Atif Hameed':role==='Design'?'Sajid Kasrana':role==='Operations'?(area==='procurement'?'Hamza Mir':'Moaz Ahsan'):'';
        const preferredTarget=candidates.find(u=>u.displayName.toLowerCase()===preferred.toLowerCase());
        const target=preferredTarget??(role==='Operations'?undefined:candidates[0]);
        if(role==='Operations'&&!target)throw Error(`The ${area==='procurement'?'Procurement':'Operations'} workspace needs the active ${preferred} account.`);
        if(!target)throw Error(`No active ${managementDepartment(destination)!.label} account is available.`);
        selected=(await api<{user:User}>('/auth/department-view',{csrf:principalSession.csrfToken,body:{userId:target.id}})).user;
        saveDepartmentUser(principalSession.user,selected);
      }else{await api('/auth/department-view',{csrf:principalSession.csrfToken,body:{userId:null}});clearDepartmentUser();}
      setDepartmentUser(selected);setDepartmentView(destination==='dashboard'?undefined:destination);
      setOperationsArea(destination==='operations'?area:'operations');
      sessionStorage.removeItem('pz:department-page');sessionStorage.removeItem('pz:workflow-open');
      setBucketTask(undefined);setDepartmentPage('Workspace');setView('dashboard');setMenuOpen(false);setMobileOpen(false);
      setWorkspaceVisit(visit=>visit+1);
      window.history.replaceState(null,'',`/dashboard#workspace=dashboard${selected?'&viewAs='+selected.role:''}${destination==='operations'?'&operationsArea='+area:''}`);
      return true;
    }catch(e){setDepartmentError(e instanceof Error?e.message:'Unable to open department.');return false;}finally{setSwitchingDepartment(false);}
  }
  useEffect(()=>{
    const raw=sessionStorage.getItem('pz:management-switch-intent');
    if(!raw)return;
    sessionStorage.removeItem('pz:management-switch-intent');
    try{const intent=JSON.parse(raw);if(canViewDepartments(principalSession.user.role)&&intent.principalId===principalSession.user.id&&(intent.destination==='dashboard'||managementDepartment(intent.destination)))void selectDepartment(intent.destination,intent.area==='procurement'?'procurement':'operations');}catch{/* Ignore stale or invalid local navigation intent. */}
  },[principalSession.user.id]);
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
      // Restore authorized workspace links after a reload as well as sidebar navigation.
      const linkedRoles:Record<string,string[]>={'project-tracking':['Management'],'receivables':['Management'],finance:['Admin','Management','Accounts'],account:['Admin','Management','Coordinator','Design','Operations','Inventory','Accounts'],team:['Admin'],boqs:['Admin','Management','Coordinator','Design'],pricing:['Admin','Management','Coordinator'],quotes:['Admin','Management','Coordinator'],orders:['Admin','Management','Coordinator','Accounts'],reports:['Admin','Management','Accounts','Inventory'],rates:['Admin','Management']};
      if(destination&&linkedRoles[destination]?.includes(session.user.role)){
        setView(destination as typeof view);return;
      }

      if(destination === "alerts" && ["Admin","Management","Accounts"].includes(session.user.role)){setView("alerts");return;}
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
  // Abu Bakar approves purchase requests (Moaz, 20 Oct 2026); nobody else sees this entry.
  const [approvals, setApprovals] = useState<{ approver: boolean; waiting: number }>({ approver: false, waiting: 0 });
  const isManagerRole = ["Admin", "Management"].includes(session.user.role);
  useEffect(() => {
    if (!isManagerRole) { setApprovals({ approver: false, waiting: 0 }); return; }
    let live = true;
    const check = () => void api<{ approver: boolean }>("/procurement/me")
      .then(async (m) => {
        if (!m.approver) { if (live) setApprovals({ approver: false, waiting: 0 }); return; }
        const r = await api<{ requests: { status: string }[] }>("/procurement/requests");
        if (live) setApprovals({ approver: true, waiting: r.requests.filter((x) => x.status === "pending_approval").length });
      })
      .catch(() => { if (live) setApprovals({ approver: false, waiting: 0 }); });
    check();
    const t = setInterval(check, 120_000);
    return () => { live = false; clearInterval(t); };
  }, [session.user.id, isManagerRole]);
  if(managementProcurement&&canViewDepartments(principalSession.user.role))return <Suspense fallback={null}><CurrentProcurementShell session={principalSession} onLogout={onLogout} viewingAs={principalSession.user.displayName} onReturn={()=>void selectDepartment("dashboard")}/></Suspense>;
  // The Operations login has its own shell (Moaz, 19 Oct 2026); every other role keeps this one unchanged.
  if ((session.user.role as string) === "Operations")
    return (
      <Suspense fallback={null}>
        <OperationsRoleGate session={session} onLogout={onLogout} viewingAs={departmentUser ? principalSession.user.displayName : undefined} onReturn={departmentUser ? () => void selectDepartment("dashboard") : undefined} />
      </Suspense>
    );
  return (
    <div className={`workspace fixed-header-layout ${(["Accounts","Admin","Management"].includes(session.user.role)&&(session.user.role==='Accounts'||['finance','receivables','project-tracking'].includes(view)))?'accounts-ui':''} ${session.user.role === "Coordinator" ? "coordinator-layout" : session.user.role === "Operations" ? "operations-layout" : ""}`}>
      <aside data-staff-sidebar={["Accounts","Coordinator","Design","Operations","Inventory"].includes(session.user.role)?true:undefined} className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
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
          {String(session.user.role) === "Admin" ? (
            <nav aria-label="Administration">
              {([["security-log","Security log","shield"],["procurement-access","Procurement access","file"],["team","Team access","file"],["masters","Databases","rates"]] as const).map(([destination,label,icon])=><button key={destination} className={view===destination?"nav-active":""} aria-current={view===destination?"page":undefined} onClick={()=>navigate(destination)}><Icon name={icon}/><span>{label}</span></button>)}
            </nav>
          ) : String(session.user.role) === "Management" ? (
            <nav aria-label="Customer workspaces"><button onClick={()=>location.assign('/operations/sites')}><Icon name="file"/><span>Operations sites</span></button><button onClick={()=>location.assign('/inventory/reconciliations')}><Icon name="shield"/><span>Inventory reconciliations</span></button><button onClick={()=>location.assign('/inventory/materials')}><Icon name="file"/><span>Inventory material issuance</span></button>
              <button className={view === "dashboard" ? "nav-active" : ""} aria-current={view === "dashboard" ? "page" : undefined} onClick={() => navigate("dashboard", undefined, true)}><Icon name="dashboard"/><span>Dashboard</span></button>
              {([
                ["ubl", "UBL Solar"],
                ["ubl-ups", "UBL UPS"],
                ["mbl-ups", "MBL UPS"],
                ["bafl-solar", "BAFL Solar"],
                ["alerts", "Alerts"],
                ["project-tracking", "Project Tracking"],
                ["receivables", "Receivables"],
              ] as const).map(([destination, label]) => (
                <button key={destination}
                  className={view === destination ? "nav-active" : ""}
                  aria-current={view === destination ? "page" : undefined}
                  onClick={() => navigate(destination)}>
                  <Icon name="file" /><span>{label}</span>
                </button>
              ))}
              {approvals.approver && (
                <button className={view === "purchase-approvals" ? "nav-active" : ""} aria-current={view === "purchase-approvals" ? "page" : undefined} onClick={() => navigate("purchase-approvals")}>
                  <Icon name="shield" /><span>Purchase approvals</span>{approvals.waiting > 0 && <small className="nav-count">{approvals.waiting}</small>}
                </button>
              )}
              {session.user.role === "Admin" && (
                <button className={view === "procurement-access" ? "nav-active" : ""} aria-current={view === "procurement-access" ? "page" : undefined} onClick={() => navigate("procurement-access")}>
                  <Icon name="users" /><span>Procurement access</span>
                </button>
              )}
              {session.user.role === "Admin" && (
                <button className={view === "security-log" ? "nav-active" : ""} aria-current={view === "security-log" ? "page" : undefined} onClick={() => navigate("security-log")}>
                  <Icon name="shield" /><span>Security log</span>
                </button>
              )}
              {approvals.approver && (
                <button className={view === "stock-watch" ? "nav-active" : ""} aria-current={view === "stock-watch" ? "page" : undefined} onClick={() => navigate("stock-watch")}>
                  <Icon name="shield" /><span>Inverter & battery stock</span>
                </button>
              )}
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
                    <Icon name="database"/><span className="sidebar-bucket-label">Databases</span>
                  </button>
                )}
                {session.user.role === "Coordinator" && <button className={view==="projects"?"nav-active":""} aria-current={view==="projects"?"page":undefined} onClick={()=>{if(navigate("projects"))setProjectContextKey(undefined);}}><Icon name="file"/><span className="sidebar-bucket-label">Projects</span></button>}
                {session.user.role === "Design" && <>
                <button className={view==='dashboard'&&departmentPage==='Survey History'?'nav-active':''} aria-current={view==='dashboard'&&departmentPage==='Survey History'?'page':undefined}
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
                  <Icon name="history"/>{session.user.role === "Design"
                    ? "Survey History"
                    : "Customer & Site Search"}
                </button>
                <button className={view==='dashboard'&&departmentPage==='Performance'?'nav-active':''} aria-current={view==='dashboard'&&departmentPage==='Performance'?'page':undefined}
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
                  <Icon name="chart"/>Performance
                </button>
                </>}
              </nav>
            </>
          ) : (
            <>
              <div className="nav-label">WORKSPACE</div>{(session.user.role==='Inventory'&&inventoryDispatcher)&&<nav aria-label="Inventory material workflow">{[['Material issuance','/inventory/materials'],['Parent DOs','/inventory/parent-dos'],['Reconciliations','/inventory/reconciliations'],['Gate passes','/inventory/gate-passes'],['Warehouse transfers','/inventory/transfers'],['Replacements','/inventory/replacements']].map(([title,path])=><button key={path} onClick={()=>location.assign(path)}><Icon name="file"/><span>{title}</span></button>)}</nav>}
              <nav aria-label="Main navigation">
                {session.user.role==='Accounts'&&[['Dashboard','My Workspace'],['IPOs Received','IPOs Received'],['Inventory & PT','Approved Documents'],['Job Closure','Job Closure'],['Physical Documents','Physical Documents']].map(([title,page])=><button key={page} className={(accountsContext||accountsPage)===page?'nav-active':''} onClick={()=>openAccountsPage(page)}><Icon name={staffNavigationIcon(title)}/><span>{title}</span></button>)}
                {session.user.role!=='Accounts'&&<button
                  className={view === "dashboard" ? "nav-active" : ""}
                  aria-current={view === "dashboard" ? "page" : undefined}
                  onClick={() => navigate("dashboard", undefined, true)}
                >
                  <Icon name="dashboard" />
                  Dashboard
                </button>}
                {["Accounts"].includes(session.user.role) && <button className={view === "alerts" ? "nav-active" : ""} aria-current={view === "alerts" ? "page" : undefined} onClick={()=>navigate("alerts")}><Icon name="bell"/><span>Alerts</span></button>}
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
              {/* Admin only: Procurement access and the security log (Moaz, 24 Oct 2026). */}
              {session.user.role === "Admin" && (
                <button className={view === "procurement-access" ? "nav-active" : ""} aria-current={view === "procurement-access" ? "page" : undefined} onClick={() => navigate("procurement-access")}>
                  <Icon name="users" />
                  Procurement access
                </button>
              )}
              {session.user.role === "Admin" && (
                <button className={view === "security-log" ? "nav-active" : ""} aria-current={view === "security-log" ? "page" : undefined} onClick={() => navigate("security-log")}>
                  <Icon name="shield" />
                  Security log
                </button>
              )}
              {[
                "Admin",
                "Management",
                "Coordinator",
                "Design",
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
              {session.user.role !== "Accounts" && <>
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
                {["Admin", "Management", "Coordinator"].includes(session.user.role) && (
                  <button
                    className={view === "customers" ? "nav-active" : ""}
                    aria-current={view === "customers" ? "page" : undefined}
                    onClick={() => navigate("customers")}
                  >
                    <Icon name="users" />
                    <span>Customers & Sites</span>
                  </button>
                )}
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
                {session.user.role === "Operations" && (
                  <>
                    <button className={view === "operations" ? "nav-active" : ""} aria-current={view === "operations" ? "page" : undefined} onClick={() => { setOperationsIpoId(undefined); navigate("operations"); }}>
                      <Icon name="file" />BOQ to Operations
                    </button>
                    <button className={view === "sites-new" ? "nav-active" : ""} aria-current={view === "sites-new" ? "page" : undefined} onClick={() => navigate("sites-new")}>
                      <Icon name="file" />New sites
                    </button>
                    <button className={view === "sites-ongoing" ? "nav-active" : ""} aria-current={view === "sites-ongoing" ? "page" : undefined} onClick={() => navigate("sites-ongoing")}>
                      <Icon name="file" />Ongoing sites
                    </button>
                    <button className={view === "sites-completed" ? "nav-active" : ""} aria-current={view === "sites-completed" ? "page" : undefined} onClick={() => navigate("sites-completed")}>
                      <Icon name="file" />Sites completed (last 30 days)
                    </button>
                    <button className={view === "sites-docs" ? "nav-active" : ""} aria-current={view === "sites-docs" ? "page" : undefined} onClick={() => navigate("sites-docs")}>
                      <Icon name="file" />Documentation issues
                    </button>
                    <button className={view === "sites" ? "nav-active" : ""} aria-current={view === "sites" ? "page" : undefined} onClick={() => navigate("sites")}>
                      <Icon name="file" />All sites
                    </button>
                    <button className={view === "reports" ? "nav-active" : ""} aria-current={view === "reports" ? "page" : undefined} onClick={() => navigate("reports")}>
                      <Icon name="file" />Site report
                    </button>
                  </>
                )}
                {["Admin", "Management", "Coordinator"].includes(
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
                {["Admin", "Management", "Coordinator", "Inventory", "Accounts"].includes(
                  session.user.role,
                ) && (
                  <button
                    className={view === "sites" ? "nav-active" : ""}
                    onClick={() => navigate("sites")}
                  >
                    <Icon name="file" />
                    Sites
                  </button>
                )}
                {["Admin", "Management", "Inventory", "Accounts"].includes(
                  session.user.role,
                ) && (
                  <button
                    className={view === "reports" ? "nav-active" : ""}
                    onClick={() => navigate("reports")}
                  >
                    <Icon name="file" />
                    Site reports
                  </button>
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
                {session.user.role === "Inventory" && (
                  <button className={view === "stock-count" ? "nav-active" : ""} aria-current={view === "stock-count" ? "page" : undefined} onClick={() => navigate("stock-count")}>
                    <Icon name="file" />
                    Stock count
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
                      : view === "procurement-access"
                        ? "Procurement access"
                      : view === "security-log"
                        ? "Security log"
                      : view === "team"
                        ? "Team access"
                        : (view === "boqs" || view === "newboq")
                          ? session.user.role === "Coordinator" ? "Create Quotation" : "Survey & BOQ"
                          : view === "pricing"
                            ? session.user.role === "Coordinator" ? "Quotation Settings" : "Commercial pricing"
                            : view === "quotes"
                              ? "Quotations"
                              : view === "reports"
                                ? "Site report"
                                : view === "sites-new"
                                ? "New sites"
                                : view === "sites-ongoing"
                                ? "Ongoing sites"
                                : view === "sites-completed"
                                ? "Sites completed (last 30 days)"
                                : view === "stock-count"
                                ? "Stock count"
                                : view === "purchase-requests"
                                ? "Purchase requests"
                                : view === "stock-watch"
                                ? "Inverter & battery stock"
                                : view === "purchase-approvals"
                                ? "Purchase approvals"
                                : view === "sites-docs"
                                ? "Documentation issues"
                                : view === "sites"
                                ? "Sites"
                                : view === "operations"
                                ? "BOQ to Operations"
                                : view === "orders"
                                  ? "Customer PO & IPO"
                                  : view === "inventory"
                                    ? "Inventory workspace"
                                    : view === "finance"
                                      ? "Accounts workspace"
                                      : view === "project-tracking" ? "Project Tracking" : view === "receivables" ? "Receivables" : "My account"}
            </strong>
          </span>
          {["Operations", "Admin", "Management"].includes(session.user.role) && (
            <GlobalSearch session={session} onOpenSite={openSiteFromAnywhere}
              onOpenHeadsUp={(reference) => { setAdvanceToOpen(reference); setAdvanceOpenNonce((n) => n + 1); setOperationsIpoId(undefined); navigate("operations"); }} />
          )}
          {session.user.role === "Coordinator" && <nav className="coordinator-shortcuts" aria-label="Atif shortcuts">
            <Button variant="neutral" aria-current={view === "newboq" ? "page" : undefined} onClick={() => { if (navigate("newboq")) setRevisionDraftId(undefined); }}>Create Quotation</Button>
            {directPoEnabled&&<Button variant="neutral" aria-current={view==='dashboard'&&departmentPage==='Direct PO'?'page':undefined} onClick={()=>{if(navigate('dashboard')){sessionStorage.setItem('pz:department-page','Direct PO');window.dispatchEvent(new CustomEvent('pz:department-page',{detail:'Direct PO'}));}}}>Direct PO</Button>}
            <Button variant="neutral" aria-current={view === "dashboard" && departmentPage === "Customer & Site Search" ? "page" : undefined} onClick={() => { if (navigate("dashboard")) { sessionStorage.setItem("pz:department-page", "Customer & Site Search"); window.dispatchEvent(new CustomEvent("pz:department-page", {detail: "Customer & Site Search"})); } }}>Customer & Site Search</Button>
            <Button variant="neutral" aria-current={view === "dashboard" && departmentPage === "Performance" ? "page" : undefined} onClick={() => { if (navigate("dashboard")) { sessionStorage.setItem("pz:department-page", "Performance"); window.dispatchEvent(new CustomEvent("pz:department-page", {detail: "Performance"})); } }}>My Performance</Button>
          </nav>}
          <NotificationCenter
            session={session}
            onOpen={(task) => {
              const operationsPath = ["Admin","Management","Accounts","Inventory"].includes(session.user.role) ? notificationPath(task) : null;
              if (operationsPath) { window.location.assign(operationsPath); return; }
              if (!navigate(task.target, task)) return;
              setPricingRevisionId(task.boq_revision_id ?? undefined);
              setPricingRequestId(task.request_id ?? undefined);
              setRevisionDraftId(task.draft_id ?? undefined);
              setOperationsIpoId(task.ipo_id ?? undefined);
            }}
          />
          <DepartmentViewSwitcher role={principalSession.user.role} value={departmentView} operationsArea={operationsArea} onProcurement={()=>selectDepartment('operations','procurement')} busy={switchingDepartment} error={departmentError} onSelect={selectDepartment}/>
          {false&&session.user.role==='Operations'&&<OperationsAreaSwitcher value={operationsArea} busy={switchingDepartment} onSelect={selectOperationsArea}/>}
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
                          : ["Admin", "Management"].includes(session.user.role) ? "Dashboard" : `Welcome, ${session.user.displayName}.`
                        : view === "design"
                          ? "Design workspace"
                          : view === "masters"
                            ? session.user.role === "Coordinator" ? "Databases" : "Master data"
                            : view === "procurement-access"
                              ? "Procurement access"
                            : view === "security-log"
                              ? "Security log"
                            : view === "team"
                              ? "Team access"
                              : (view === "boqs" || view === "newboq")
                                ? session.user.role === "Coordinator" ? "Create Quotation" : "Survey & BOQ"
                                : view === "pricing"
                                  ? session.user.role === "Coordinator" ? "Quotation Settings" : "Commercial pricing"
                                  : view === "quotes"
                                    ? "Quotations"
                                    : view === "reports"
                                      ? "Site report"
                                      : view === "sites-new"
                                      ? "New sites"
                                      : view === "sites-ongoing"
                                      ? "Ongoing sites"
                                      : view === "sites-completed"
                                      ? "Sites completed (last 30 days)"
                                      : view === "stock-count"
                                      ? "Stock count"
                                      : view === "purchase-requests"
                                      ? "Purchase requests"
                                      : view === "stock-watch"
                                      ? "Inverter & battery stock"
                                      : view === "purchase-approvals"
                                      ? "Purchase approvals"
                                      : view === "sites-docs"
                                      ? "Documentation issues"
                                      : view === "sites"
                                      ? "Sites"
                                      : view === "operations"
                                      ? "BOQ to Operations"
                                      : view === "orders"
                                        ? "Customer PO & IPO"
                                        : view === "inventory"
                                          ? "Inventory workspace"
                                          : view === "finance"
                                            ? "Accounts workspace"
                                            : view === "project-tracking" ? "Project Tracking" : view === "receivables" ? "Receivables" : "My account"}
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
                                ? "Where every site and problem stands today."
                                : ["Admin", "Management"].includes(
                                      session.user.role,
                                    )
                                  ? "Review quotations awaiting your approval, received IPOs and installation progress."
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
                                  : view === "procurement-access"
                                    ? "Grant or remove Procurement buyer and approver by exact email. Every change is kept."
                                  : view === "security-log"
                                    ? "Sign-ins, price and cost views, approvals, access changes and backups."
                                  : view === "team"
                                    ? "Invite and manage authorised team members."
                                    : view === "reports"
                                      ? "Every site's stage and dates, cable variance against BOQ, and items used outside the quotation. Downloadable."
                                      : view === "sites-new"
                                      ? "IPO received, planning not started."
                                      : view === "sites-ongoing"
                                      ? "Every site that is not closed, from IPO received to Doc dispatch."
                                      : view === "sites-completed"
                                      ? "Sites closed in the last 30 days."
                                      : view === "stock-count"
                                      ? "Receive what Procurement ordered and keep the stock count. Procurement uses these counts to work out what to buy."
                                      : view === "purchase-requests"
                                      ? "Purchase requests from Procurement, with prices. Read only."
                                      : view === "stock-watch"
                                      ? "Inverters, batteries and BMS against the coming sites. You are alerted when to order."
                                      : view === "purchase-approvals"
                                      ? "Purchase requests from Procurement. Only you can approve them."
                                      : view === "sites-docs"
                                      ? "Sites at Doc dispatch, or closed, still missing the DO date, acknowledgement, submission to the customer or customer sign-off."
                                      : view === "sites"
                                      ? "Every site after its IPO: IPO received, planning, delivery, installation, commissioning, handover, doc dispatch, closed."
                                      : view === "operations"
                                      ? "Advance BOQs received from Coordination. Filter by stage, customer, site, region and date; search from the top bar."
                                      : view === "orders"
                                        ? "Turn an accepted quotation and customer PO into an internal purchase order."
                                        : view === "inventory"
                                          ? "Stock preparation and dispatch document queues."
                                          : view === "finance"
                                            ? "IPO review and supporting-document queues."
                                            : view === "project-tracking" ? "View-only project stages, invoice status and payments." : view === "receivables" ? "View-only customer receivables and invoice ageing." : "Your identity and access to the Power Zone workspace."}
                  </p>
                </div>
              </div>
              {["Coordinator", "Design"].includes(session.user.role) &&
                view !== "dashboard" && (
                  <Button
                    variant="neutral"
                    className={view==='projects'||view==='documents'?'library-back-button':undefined}
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
              {canUseLibrary && (
                <div hidden={view !== "projects" && view !== "documents"}>
                  <CoordinatorLibrary
                    session={session}
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
                  initialTab={accountsPage}
                  onContextChange={setAccountsContext}
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
                <OperationsHome session={session} onGo={(target) => { if (target === "operations") setOperationsIpoId(undefined); navigate(target); }} onOpenSite={openSiteFromAnywhere} onOpenStage={(stage) => { setStageToOpen(stage); setSiteToOpen(undefined); navigate("sites"); }} />
              )}
              {view==='project-tracking'&&session.user.role==='Management'&&<ProgrammeDashboard userId={session.user.id} title="Project Tracking" endpoint="/accounts-workspace/programmes"/>}
              {view==='receivables'&&session.user.role==='Management'&&<AccountsBilling mode="receivables"/>}
              {managementHome && <ManagementDashboard session={session} onOpenUps={()=>navigate("ubl-ups")} onOpenSolar={()=>navigate("ubl")} onOpen={(task)=>{
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
                    startQuotationRevision={bucketTask?.startQuotationRevision===true}
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
                    onRevisionDraft={(id,preparationEdit) => {
                      setRevisionDraftId(id);
                      navigate(preparationEdit?"newboq":"boqs");
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
                  startRevision={bucketTask?.reviseBoq===true}
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
              {view === "sites" && <SiteBoard session={session} mode="all" initialSiteId={siteToOpen} initialSiteNonce={siteOpenNonce} initialStage={stageToOpen} />}
              {view === "sites-new" && <SiteBoard session={session} mode="new" />}
              {view === "sites-ongoing" && <SiteBoard session={session} mode="ongoing" />}
              {view === "sites-completed" && <SiteBoard session={session} mode="completed" />}
              {view === "sites-docs" && <SiteBoard session={session} mode="docs" />}
              {view === "reports" && <SiteReport session={session} />}
              {view === "stock-count" && session.user.role === "Inventory" && <StoreStock session={session} />}
              {view === "stock-watch" && approvals.approver && <StockWatch session={session} />}
              {view === "procurement-access" && session.user.role === "Admin" && <ProcurementAccess session={session} />}
              {view === "security-log" && session.user.role === "Admin" && <SecurityLog />}
              {view === "purchase-requests" && session.user.role === "Accounts" && <PurchaseApprovals session={session} mode="reader" />}
              {view === "purchase-approvals" && approvals.approver && <PurchaseApprovals session={session} onChanged={() => setApprovals((a) => ({ ...a }))} />}
              {view === "operations" && (
                <Operations session={session} initialIpoId={operationsIpoId} portal={departmentView==='operations'} initialAdvanceReference={advanceToOpen} advanceNonce={advanceOpenNonce} />
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
              {view === "alerts" && ["Admin","Management","Accounts"].includes(session.user.role) && <UpsAlerts/>}
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

export function PasswordChange({
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

