import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type Session } from "../api.js";
import {notificationPath,notificationDocumentUrl} from "../../shared/notification-target.js";
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
  onOpenPath,
}: {
  session: Session;
  onOpen: (task: any) => boolean;
  onOpenPath?: (path:string)=>boolean;
}) {
  const handledLink=useRef<string|null>(null);
  const inboxActor = useRef(session.user.id);
  const itemsActor = useRef(session.user.id);
  const actorEpoch = useRef(0);
  // A read mutation invalidates older polling responses before they can restore
  // stale badges. Share concurrent refreshes within the same inbox generation.
  const inboxGeneration = useRef(0);
  const inboxLoad = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const marking = useRef(false);
  const readMutation = useRef<Promise<void> | null>(null);
  const [items, setItems] = useState<Notice[]>([]),
    [open, setOpen] = useState(false),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [email, setEmail] = useState(true),
    [unread, setUnread] = useState(0),
    [hasMore, setHasMore] = useState(false);
  useLayoutEffect(() => {
    if (inboxActor.current !== session.user.id) {
      inboxActor.current = session.user.id;
      handledLink.current = null;
      setItems([]);
      setUnread(0);
      setHasMore(false);
      setOpen(false);
      setFilter("all");
      setError("");
      setEmail(true);
    }
    return () => {
      // Invalidate the previous actor before paint or any pending response.
      actorEpoch.current += 1;
      inboxGeneration.current += 1;
      inboxLoad.current = null;
      readMutation.current = null;
      marking.current = false;
    };
  }, [session.user.id]);
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  function openTarget(target:unknown,noticeId:string){
    const path=notificationPath(target);
    if(path){if(window.location.pathname===path)return true;if(onOpenPath)return onOpenPath(path);window.location.assign(path+'#notification='+encodeURIComponent(noticeId));return false;}
    if(target&&typeof target==='object'&&'path' in target){setError('This notification destination is unavailable. Your work is unchanged.');return false;}
    const url=notificationDocumentUrl(target);
    if(url){window.open(url,'_blank','noopener,noreferrer');return true;}
    if(!target||typeof target!=='object'||typeof (target as {target?:unknown}).target!=='string'){setError('This notification destination is unavailable.');return false;}
    return onOpen(target);
  }
  function load(): Promise<void> {
    if (marking.current) return Promise.resolve();
    const generation = inboxGeneration.current;
    if (inboxLoad.current?.generation === generation) return inboxLoad.current.promise;
    const promise = refresh(generation);
    inboxLoad.current = { generation, promise };
    void promise.finally(() => {
      if (inboxLoad.current?.promise === promise) inboxLoad.current = null;
    });
    return promise;
  }
  async function refresh(generation: number) {
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
      if (generation !== inboxGeneration.current) return;
      itemsActor.current = session.user.id;
      setItems(r.notifications);
      setUnread(r.unreadCount);
      setHasMore(r.hasMore);
      setError("");
    } catch {
      if (generation === inboxGeneration.current) setError("Notifications could not refresh. Your work is unaffected.");
    }
  }
  useEffect(() => {
    const epoch = actorEpoch.current;
    void load();
    void api<{ email_enabled: boolean }>("/notifications/preferences")
      .then((p) => { if (epoch === actorEpoch.current) setEmail(p.email_enabled); })
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
    if (!id){handledLink.current=null;return;}
    if(!items.length||handledLink.current===id)return;
    if (itemsActor.current !== session.user.id) return;
    const n = items.find((n) => n.id === id);
    if (n) {
      handledLink.current=id;
      if(openTarget(n.target,n.id)){
        const hash=new URLSearchParams(window.location.hash.slice(1));hash.delete('notification');
        window.history.replaceState(null,'',window.location.pathname+window.location.search+(hash.size?'#'+hash.toString():''));
        setOpen(false);void mark(n.id);
      }
    }
  }, [items]);
  function mark(id?: string): Promise<void> {
    const epoch = actorEpoch.current;
    const pending = readMutation.current;
    if (pending) return id ? pending.then(() => epoch === actorEpoch.current ? mark(id) : undefined) : pending;
    const promise = persistRead(id);
    readMutation.current = promise;
    void promise.finally(() => {
      if (readMutation.current === promise) readMutation.current = null;
    });
    return promise;
  }
  async function persistRead(id?: string) {
    const epoch = actorEpoch.current;
    marking.current = true;
    inboxGeneration.current += 1;
    try {
      await api("/notifications/read", {
        body: id ? { id } : {},
        csrf: session.csrfToken,
      });
      if (epoch !== actorEpoch.current) return;
      // Read state and count come from the persisted inbox, including any new
      // notifications created after the acknowledgment statement completed.
      marking.current = false;
      inboxGeneration.current += 1;
      await load();
    } catch {
      if (epoch === actorEpoch.current) setError("Could not mark notifications as read.");
    } finally {
      if (epoch === actorEpoch.current) marking.current = false;
    }
  }
  async function more() {
    const epoch = actorEpoch.current;
    const last = items.at(-1);
    if (!last) return;
    try {
      const r = await api<{ notifications: Notice[]; hasMore: boolean }>(
        `/notifications?beforeTime=${encodeURIComponent(last.created_at)}&beforeId=${last.id}`,
      );
      if (epoch !== actorEpoch.current) return;
      setItems((prev) => [
        ...prev,
        ...r.notifications.filter((n) => !prev.some((p) => p.id === n.id)),
      ]);
      setHasMore(r.hasMore);
    } catch {
      if (epoch === actorEpoch.current) setError("Earlier notifications could not load.");
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
          if (!open) void mark();
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
          {error && <p role="alert">{error}</p>}
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
                      const epoch = actorEpoch.current;
                      await mark(n.id);
                      if(epoch === actorEpoch.current && openTarget(n.target,n.id))setOpen(false);
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
                      · {notificationPath(n.target)?"Open site":notificationDocumentUrl(n.target)?"Open document":"Open task"} →
                    </small>
                  </button>
                  <button
                    className="text-button"
                    onClick={async () => {
                      if (n.read_at) {
                        const epoch = actorEpoch.current;
                        try {
                          inboxGeneration.current += 1;
                          await api("/notifications/unread", {
                            body: { id: n.id },
                            csrf: session.csrfToken,
                          });
                          if (epoch !== actorEpoch.current) return;
                          inboxGeneration.current += 1;
                          await load();
                        } catch {
                          if (epoch === actorEpoch.current) setError("Could not update read status.");
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
                  const epoch = actorEpoch.current;
                  try {
                    await api("/notifications/preferences", {
                      body: { email_enabled: value },
                      csrf: session.csrfToken,
                    });
                    if (epoch === actorEpoch.current) setEmail(value);
                  } catch {
                    if (epoch === actorEpoch.current) setError("Preference could not be saved.");
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
