// Disposable local preview. No production credentials or data are loaded.
import { testDatabase } from "./database.js";
import { hashPassword } from "../server/auth/crypto.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { NotificationsRepository } from "../server/notifications/repository.js";
import { surveyDraftSchema } from "../server/boq/schema.js";
import { randomUUID } from "node:crypto";
const db = await testDatabase(),
  owner = randomUUID(),
  actor = randomUUID(),
  draft = randomUUID(),
  survey = randomUUID();
await db.pool.query(
  "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'preview@example.test','Preview Coordinator','Coordinator',$2),($3,'design@example.test','Design Team','Design',$2)",
  [owner, await hashPassword("isolated-preview-only"), actor],
);
await db.pool.query("UPDATE admin_bootstrap SET completed_at=now()");
await db.pool.query(
  "INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)",
  [
    draft,
    owner,
    surveyDraftSchema.parse({ siteName: "Notification preview site" }),
  ],
);
await db.pool.query(
  "INSERT INTO design_surveys(id,owner_id,inputs) VALUES($1,$2,$3)",
  [
    survey,
    actor,
    surveyDraftSchema.parse({ siteName: "Notification preview site" }),
  ],
);
await db.pool.query(
  "INSERT INTO design_survey_handoffs(id,survey_id,form_version,draft_id,assigned_to,created_by,inputs) VALUES($1,$2,1,$3,$4,$5,$6)",
  [
    randomUUID(),
    survey,
    draft,
    owner,
    actor,
    surveyDraftSchema.parse({ siteName: "Notification preview site" }),
  ],
);
await new NotificationsRepository(db.pool).sync();
const app = createApp(
  db.pool,
  readConfig({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3197",
    DATABASE_URL: db.url,
    ADMIN_SETUP_TOKEN: "isolated-notification-preview-only-key",
  }),
  "dist/web",
);
const server = app.listen(3197, "127.0.0.1", () =>
  console.log("Isolated notification preview ready on port 3197"),
);
process.on("SIGTERM", () =>
  server.close(() => void db.close().then(() => process.exit(0))),
);
