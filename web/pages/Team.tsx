import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";
import type {TeamAccessProfile} from "../../shared/team-access-profile.js";
import { Backups } from "./Backups.js";
type Person = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  active: boolean;
  email_verified_at: string | null;
  operations_access?:{kind:"qc"|"lead"|"head";team:"central"|"south"|null}|null;
  warehouse_access?:{warehouse:string;capability:"dispatcher"|"storekeeper"}[];
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  delivery_status: string;
};
export function Team({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [selectedRole,setSelectedRole]=useState("Employee");
  const [region,setRegion]=useState<"central"|"south">("central");
  const [warehouses,setWarehouses]=useState<string[]>([]);
  const [knownWarehouses,setKnownWarehouses]=useState<string[]>([]);
  const scoped=["QC","Operations Lead","Storekeeper"].includes(selectedRole);
  const [creationMode, setCreationMode] = useState<"invite" | "direct">(
    "invite",
  );
  const [data, setData] = useState<{
      users: Person[];
      invitations: Invitation[];
      emailConfigured: boolean;
    }>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<{
      id: string;
      label: string;
      body: object;
      path: string;
    }>();
  async function load() {
    try {
      setData(await api("/accounts"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else
        setError(e instanceof Error ? e.message : "Unable to load accounts.");
    }
  }
  useEffect(() => {
    void load();
    if(session.user.role==="Admin")void api<{warehouses:string[]}>("/accounts/access-options").then(v=>setKnownWarehouses(v.warehouses)).catch(e=>setError(e instanceof Error?e.message:"Unable to load warehouse assignments."));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if(!action&&scoped&&creationMode==="invite"){setError("Use Create account with password to assign this scoped profile. Email invitations do not retain these assignments.");return;}
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ message: string }>(
        action
          ? action.path
          : creationMode === "direct"
            ? "/accounts/create"
            : "/accounts/invite",
        {
          csrf: session.csrfToken,
          body: action
            ? { ...action.body, password: f.get("password") }
            : {
                ...(creationMode === "direct"
                  ? {
                      displayName: f.get("displayName"),
                      newPassword: f.get("newPassword"),
                      confirmPassword: f.get("confirmPassword"),
                    }
                  : {}),
                email: f.get("email"),
                role:scoped?(selectedRole==='Storekeeper'?'Inventory':'Operations'):f.get("role"),
                ...(scoped?{scopedAccess:selectedRole==='Storekeeper'?{kind:'Storekeeper',warehouses}:{kind:selectedRole as "QC"|"Operations Lead",region} satisfies TeamAccessProfile}:{}),
                password: f.get("password"),
              },
        },
      );
      setMessage(result.message);
      form.reset();
      if(!action){setSelectedRole("Employee");setWarehouses([]);}
      setAction(undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-panel">
      <h2>Team access</h2>
      <p>
        Invite employees, choose their role, and end access when required.
        Invitations verify ownership of the employee’s email before an account
        is created.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {!data ? (
        <p role="status">Loading accounts…</p>
      ) : (
        <>
          {!data.emailConfigured && (
            <p className="form-note">
              Email activation pending. Invitations and password-reset emails
              will be available after the sender is configured.
            </p>
          )}
          {!action && (
            <div className="survey-actions">
              <button onClick={() => setCreationMode("direct")} disabled={busy}>
                Create account with password
              </button>
              <button onClick={() => setCreationMode("invite")} disabled={busy}>
                Email invitation
              </button>
            </div>
          )}
          <form onSubmit={submit} className="team-form">
            <h3>
              {action
                ? action.label
                : creationMode === "direct"
                  ? "Create a separate login"
                  : "Invite a team member"}
            </h3>
            {!action && (
              <>
                {creationMode === "direct" && (
                  <>
                    <label>
                      Full name
                      <input
                        name="displayName"
                        aria-label="New account name"
                        required
                        maxLength={100}
                      />
                    </label>
                    <label>
                      New account password
                      <input
                        name="newPassword"
                        aria-label="New account password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                      />
                    </label>
                    <label>
                      Confirm new account password
                      <input
                        name="confirmPassword"
                        aria-label="Confirm new account password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                      />
                    </label>
                  </>
                )}
                <label>
                  Email address
                  <input
                    aria-label="Employee email"
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                  />
                </label>
                <label>
                  Role
                  <select
                    aria-label="Employee role"
                    name="role"
                    value={selectedRole}
                    onChange={e=>{setSelectedRole(e.target.value);setWarehouses([]);}}
                  >
                    <option>Employee</option>
                    <option>Coordinator</option>
                    <option>Operations</option>
                    <option>QC</option>
                    <option>Operations Lead</option>
                    <option>Storekeeper</option>
                    <option>Inventory</option>
                    <option>Accounts</option>
                    <option>Design</option>
                    <option>Management</option>
                    <option>Admin</option>
                  </select>
                </label>
                {scoped&&selectedRole!=='Storekeeper'&&<label>Region<select aria-label="Assigned Operations region" value={region} onChange={e=>setRegion(e.target.value as 'central'|'south')}><option value="central">Central</option><option value="south">South</option></select><span className="form-note">{selectedRole==='QC'?'Progress dates, evidence and document tracking for assigned sites.':'Operations planning and oversight for the assigned region.'}</span></label>}
                {selectedRole==='Storekeeper'&&<fieldset><legend>Assigned warehouses</legend>{knownWarehouses.length?knownWarehouses.map(w=><label key={w}><input type="checkbox" checked={warehouses.includes(w)} onChange={e=>setWarehouses(old=>e.target.checked?[...old,w]:old.filter(v=>v!==w))}/>{w}</label>):<p className="form-note">No warehouses are available in the current register.</p>}<p className="form-note">Print gate passes and upload signed copies for selected warehouses. No material issuance or reconciliation decisions.</p></fieldset>}
                {scoped&&creationMode==='invite'&&<p role="status" className="form-note">Use Create account with password for scoped access. Email invitations create only the selected base role and cannot retain these assignments.</p>}
              </>
            )}
            <label>
              Your current password
              <input
                aria-label="Your current password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <button
              className="primary"
              disabled={
                busy || (!action&&scoped&&(creationMode==="invite"||(selectedRole==="Storekeeper"&&!warehouses.length))) ||
                (!action && creationMode === "invite" && !data.emailConfigured)
              }
            >
              {busy
                ? "Saving…"
                : action
                  ? "Confirm account change"
                  : creationMode === "direct"
                    ? "Create account"
                    : "Send invitation"}
            </button>
            {action && (
              <button type="button" onClick={() => setAction(undefined)}>
                Cancel
              </button>
            )}
          </form>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name / Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} style={{verticalAlign:"top"}}>
                    <td>
                      {u.display_name}
                      <br />
                      {u.email}
                    </td>
                    <td style={{verticalAlign:'top'}}>
                      <div>{u.role==='Operations'&&u.operations_access?u.operations_access.kind==='qc'?'QC':u.operations_access.kind==='lead'?'Operations Lead':'Operations Head':u.role==='Inventory'&&u.warehouse_access?.length&&u.warehouse_access.every(w=>w.capability==='storekeeper')?'Storekeeper':u.role}</div>
                      {u.role==='Operations'&&u.operations_access?.team&&<div className="form-note">{u.operations_access.team==='central'?'Central':'South'}</div>}
                      {u.role==='Inventory'&&!!u.warehouse_access?.length&&<div className="form-note">{u.warehouse_access.map(w=>w.warehouse).join(', ')}</div>}
                    </td>
                    <td>{u.active ? "Active" : "Disabled"}</td>
                    <td>
                      {u.email_verified_at
                        ? "Verified"
                        : "Verification pending"}
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          setAction({
                            id: u.id,
                            path: `/accounts/users/${u.id}`,
                            label: `End all sessions for ${u.display_name}`,
                            body: { revokeSessions: true },
                          })
                        }
                      >
                        End sessions
                      </button>
                      {u.id !== session.user.id && (
                        <>
                          <button
                            onClick={() =>
                              setAction({
                                id: u.id,
                                path: `/accounts/users/${u.id}`,
                                label: `${u.active ? "Disable" : "Enable"} ${u.display_name}`,
                                body: { active: !u.active },
                              })
                            }
                          >
                            {u.active ? "Disable" : "Enable"}
                          </button>
                          <select
                            aria-label={`Change role for ${u.display_name}`}
                            value={u.role}
                            onChange={(e) =>
                              setAction({
                                id: u.id,
                                path: `/accounts/users/${u.id}`,
                                label: `Change ${u.display_name} to ${e.target.value}`,
                                body: { role: e.target.value },
                              })
                            }
                          >
                            <option>Employee</option>
                            <option>Coordinator</option>
                            <option>Operations</option>
                            <option>Inventory</option>
                            <option>Accounts</option>
                            <option>Design</option>
                            <option>Management</option>
                            <option>Admin</option>
                          </select>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Pending invitations</h3>
          {data.invitations.length === 0 ? (
            <p>No pending invitations.</p>
          ) : (
            data.invitations.map((i) => (
              <div key={i.id}>
                <span>
                  {i.email} · {i.role} · {i.delivery_status} · expires{" "}
                  {new Date(i.expires_at).toLocaleString()}
                </span>{" "}
                <button
                  onClick={() =>
                    setAction({
                      id: i.id,
                      path: `/accounts/invitations/${i.id}/revoke`,
                      label: `Cancel invitation for ${i.email}`,
                      body: {},
                    })
                  }
                >
                  Cancel invitation
                </button>
              </div>
            ))
          )}
        </>
      )}
      <Backups session={session} />
    </section>
  );
}
