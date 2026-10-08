import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
export function NotificationAdmin({ session }: { session: Session }) {
  const [data, setData] = useState<any>(),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setData(await api("/notifications/settings"));
    } catch {
      setMessage("Notification settings could not load.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (!data) return <p>{message || "Loading notification settings…"}</p>;
  async function save() {
    try {
      await api("/notifications/settings", {
        body: {
          email_enabled: data.email_enabled,
          reminders_enabled: data.reminders_enabled,
          reminder_hours: Number(data.reminder_hours),
        },
        csrf: session.csrfToken,
      });
      setMessage("Notification settings saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    }
  }
  return (
    <section className="detail-panel">
      <h2>Communication settings</h2>
      <p>
        Workflow recipients follow document ownership and departmental
        permissions. Security emails cannot be disabled by employee preferences.
      </p>
      <div className="form-grid">
        <label>
          <input
            type="checkbox"
            checked={data.email_enabled}
            onChange={(e) =>
              setData({ ...data, email_enabled: e.target.checked })
            }
          />{" "}
          Enable workflow emails
        </label>
        <label>
          <input
            type="checkbox"
            checked={data.reminders_enabled}
            onChange={(e) =>
              setData({ ...data, reminders_enabled: e.target.checked })
            }
          />{" "}
          Enable overdue reminders
        </label>
        <label>
          Remind after hours
          <input
            type="number"
            min="4"
            max="720"
            value={data.reminder_hours}
            onChange={(e) =>
              setData({ ...data, reminder_hours: e.target.value })
            }
          />
        </label>
        <p>
          One reminder after this interval; one Management escalation after
          twice the interval. Completed tasks stop reminders.
        </p>
      </div>
      <button className="primary" onClick={() => void save()}>
        Save notification settings
      </button>
      <p role="status">{message}</p>
      <h3>Notification types & email headings</h3>
      <p>
        Headings are shared by in-app notifications and emails. Layout and
        branding remain consistent.
      </p>
      {data.types.map((t: any, index: number) => (
        <div className="form-grid" key={t.kind}>
          <label>
            {t.kind}
            <input
              value={t.title}
              maxLength={100}
              onChange={(e) =>
                setData({
                  ...data,
                  types: data.types.map((v: any, i: number) =>
                    i === index ? { ...v, title: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              disabled={t.critical}
              checked={t.email_enabled}
              onChange={(e) =>
                setData({
                  ...data,
                  types: data.types.map((v: any, i: number) =>
                    i === index ? { ...v, email_enabled: e.target.checked } : v,
                  ),
                })
              }
            />{" "}
            Email{t.critical ? " (essential security message)" : ""}
          </label>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await api("/notifications/types", {
                  body: {
                    kind: t.kind,
                    title: t.title,
                    email_enabled: t.email_enabled,
                  },
                  csrf: session.csrfToken,
                });
                setMessage("Notification type saved.");
              } catch {
                setMessage("Could not save notification type.");
              }
            }}
          >
            Save {t.kind}
          </button>
        </div>
      ))}
      <h3>Delivery queue</h3>
      <p>
        {data.delivery
          .map(
            (v: any) =>
              `${v.state}${v.provider_status ? " / " + v.provider_status : ""}: ${v.count}`,
          )
          .join(" · ") || "No workflow emails queued."}
      </p>
      <small>
        “Sent” means the provider accepted delivery. Provider delivery/bounce
        confirmation is separate.
      </small>
    </section>
  );
}
