import { useEffect, useRef, useState } from "react";
import { api, type Session } from "../api.js";
type Notice = {
  id: string;
  title: string;
  reference: string;
  actor: string;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
  actionable: boolean;
  target: any;
};
export function NotificationCenter({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (task: any) => void;
}) {
  const handledLink=useRef<string|null>(null);
  const [items, setItems] = useState<Notice[]>([]),
    [open, setOpen] = useState(false),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [email, setEmail] = useState(true),
    [unread, setUnread] = useState(0),
    [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  async function load() {
    try {
      const r = await api<{
        notifications: Notice[];
        unreadCount: number;
        hasMore: boolean;
      }>("/notifications");
      const id = new URLSearchParams(window.location.hash.slice(1)).get(
        "notification",
      );
      if (
        id &&
        !r.notifications.some((n) => n.id === id) &&
        /^[0-9a-f-]{36}$/i.test(id)
      ) {
        const n = await api<Notice>("/notifications/item/" + id);
        r.notifications.unshift(n);
      }
      setItems(r.notifications);
      setUnread(r.unreadCount);
      setHasMore(r.hasMore);
      setError("");
    } catch {
      setError("Notifications could not refresh. Your work is unaffected.");
    }
  }
  useEffect(() => {
    void load();
    void api<{ email_enabled: boolean }>("/notifications/preferences")
      .then((p) => setEmail(p.email_enabled))
      .catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    window.addEventListener("focus", load);
    window.addEventListener("hashchange", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("hashchange", load);
    };
  }, [session.user.id]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.slice(1)).get(
      "notification",
    );
    if (!id || !items.length) return;
    const n = items.find((n) => n.id === id);
    if (n) {
      if(handledLink.current===id)return;
      handledLink.current=id;
      setOpen(false);
      window.history.replaceState(null, "", "/dashboard");
      void mark(n.id).then(()=>onOpen(n.target));
    }
  }, [items]);
  async function mark(id?: string) {
    try {
      await api("/notifications/read", {
        body: id ? { id } : {},
        csrf: session.csrfToken,
      });
      const readAt = new Date().toISOString();
      const acknowledged = items.filter(n => (!id || n.id === id) && !n.read_at && !n.resolved_at).length;
      setItems(previous => previous.map(n => !id || n.id === id ? {...n, read_at: n.read_at || readAt} : n));
      setUnread(previous => id ? Math.max(0, previous - acknowledged) : 0);
      await load();
    } catch {
      setError("Could not mark notifications as read.");
    }
  }
  async function more() {
    const last = items.at(-1);
    if (!last) return;
    try {
      const r = await api<{ notifications: Notice[]; hasMore: boolean }>(
        `/notifications?beforeTime=${encodeURIComponent(last.created_at)}&beforeId=${last.id}`,
      );
      setItems((prev) => [
        ...prev,
        ...r.notifications.filter((n) => !prev.some((p) => p.id === n.id)),
      ]);
      setHasMore(r.hasMore);
    } catch {
      setError("Earlier notifications could not load.");
    }
  }
  return (
    <div className="notification-anchor">
      <button
        className="icon-button notification-bell"
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          void load();
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unread > 0 && <span className="notification-count">{unread}</span>}
      </button>
      {open && (
        <section
          className="notification-panel"
          aria-label="Notification center"
        >
          <header>
            <h2>Notifications</h2>
            <button className="text-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>
          <div className="notification-filters">
            {["all", "unread", "pending", "history"].map((f) => (
              <button
                key={f}
                className={filter === f ? "primary" : "secondary"}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {error && <p role="status">{error}</p>}
          <button className="text-button" onClick={() => void mark()}>
            Mark all as read
          </button>
          <div className="notification-list">
            {items
              .filter(
                (n) =>
                  filter === "all" ||
                  (filter === "unread" && !n.read_at && !n.resolved_at) ||
                  (filter === "pending" && n.actionable && !n.resolved_at) ||
                  (filter === "history" && !!n.resolved_at),
              )
              .map((n) => (
                <article
                  key={n.id}
                  className={!n.read_at ? "notice notice-unread" : "notice"}
                >
                  <button
                    className="notice-link"
                    onClick={async () => {
                      if (
                        typeof n.target.url === "string" &&
                        /^\/api\/(project-workflow|orders)\/[A-Za-z0-9/-]+$/.test(
                          n.target.url,
                        )
                      )
                        window.open(
                          n.target.url,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      else { await mark(n.id); onOpen(n.target); setOpen(false); return; }
                      await mark(n.id);
                      setOpen(false);
                    }}
                  >
                    <strong>{n.title}</strong>
                    <span>{n.reference}</span>
                    <small>
                      {n.actor} ·{" "}
                      {new Date(n.created_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Karachi",
                      })}{" "}
                      PKT
                    </small>
                    <small>
                      {n.resolved_at
                        ? "Completed / superseded"
                        : n.actionable
                          ? "Action required"
                          : "Update"}{" "}
                      · Open document →
                    </small>
                  </button>
                  <button
                    className="text-button"
                    onClick={async () => {
                      if (n.read_at) {
                        try {
                          await api("/notifications/unread", {
                            body: { id: n.id },
                            csrf: session.csrfToken,
                          });
                          await load();
                        } catch {
                          setError("Could not update read status.");
                        }
                      } else void mark(n.id);
                    }}
                  >
                    {n.read_at ? "Mark unread" : "Mark read"}
                  </button>
                </article>
              ))}
            {!items.length && (
              <p className="empty-state">
                You’re all caught up. New workflow updates will appear here.
              </p>
            )}
          </div>
          {hasMore && (
            <button className="text-button" onClick={() => void more()}>
              Load earlier notifications
            </button>
          )}
          <footer>
            <label>
              <input
                type="checkbox"
                checked={email}
                onChange={async (e) => {
                  const value = e.target.checked;
                  try {
                    await api("/notifications/preferences", {
                      body: { email_enabled: value },
                      csrf: session.csrfToken,
                    });
                    setEmail(value);
                  } catch {
                    setError("Preference could not be saved.");
                  }
                }}
              />{" "}
              Email me important workflow updates
            </label>
            <small>
              Security emails remain essential. Completed requests stay in
              history.
            </small>
          </footer>
        </section>
      )}
    </div>
  );
}
