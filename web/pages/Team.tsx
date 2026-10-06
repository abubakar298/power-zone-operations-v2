import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";
type Person = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  active: boolean;
  email_verified_at: string | null;
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
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
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
                role: f.get("role"),
                password: f.get("password"),
              },
        },
      );
      setMessage(result.message);
      form.reset();
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
                    defaultValue="Employee"
                  >
                    <option>Employee</option>
                    <option>Coordinator</option>
                    <option>Operations</option>
                    <option>Inventory</option>
                    <option>Accounts</option>
                    <option>Management</option>
                    <option>Admin</option>
                  </select>
                </label>
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
                busy ||
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
                  <tr key={u.id}>
                    <td>
                      {u.display_name}
                      <br />
                      {u.email}
                    </td>
                    <td>{u.role}</td>
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
    </section>
  );
}
