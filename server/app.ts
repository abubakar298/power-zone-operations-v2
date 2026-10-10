import {inventoryHttp} from './inventory/http.js';
import {InventoryRepository} from './inventory/repository.js';
import {ublHttp} from './ubl/http.js';
import {UblRepository} from './ubl/repository.js';
import {notificationWebhook} from "./notifications/webhook.js";
import {NotificationsRepository} from "./notifications/repository.js";
import {notificationsHttp} from "./notifications/http.js";
import { financialVisibility } from "./http/cost-visibility.js";
import { cniHttp } from "./commercial/cni-http.js";
import { DesignRepository } from "./design/repository.js";
import { backupsHttp } from "./backups/http.js";
import { backupDevicesHttp } from "./backups/devices.js";
import { designHttp } from "./design/http.js";
import { DepartmentRepository } from "./departments/repository.js";
import { departmentsHttp } from "./departments/http.js";
import { DirectorRepository } from "./director/repository.js";
import { directorHttp } from "./director/http.js";
import { CoordinatorRepository } from "./coordinator/repository.js";
import { coordinatorHttp } from "./coordinator/http.js";
import { OperationsRepository } from "./operations/repository.js";
import { operationsHttp } from "./operations/http.js";
import { CommercialRepository } from "./commercial/repository.js";
import { commercialHttp } from "./commercial/http.js";
import { OrdersRepository } from "./orders/repository.js";
import { ordersHttp } from "./orders/http.js";
import { BoqRepository } from "./boq/repository.js";
import { boqHttp, uploadHttp } from "./boq/http.js";
import { AccountsRepository } from "./onboarding/repository.js";
import { AccountsService } from "./onboarding/service.js";
import { accountsHttp } from "./onboarding/http.js";
import { ResendDelivery, type EmailDelivery } from "./email/delivery.js";
import express, { type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import helmet from "helmet";
import type { Pool } from "pg";
import { resolve } from "node:path";
import type { Config } from "./config.js";
import { AuthRepository } from "./auth/repository.js";
import { AuthService } from "./auth/service.js";
import { authHttp } from "./auth/http.js";
import { dashboardRoutes } from "./dashboard/routes.js";
import { HttpError } from "./http/errors.js";
import { workflowBoundary, coordinatorRecords } from "./http/permissions.js";
import { MastersRepository } from "./masters/repository.js";
import { mastersHttp } from "./masters/http.js";

export function createApp(
  pool: Pool,
  config: Config,
  webDirectory?: string,
  delivery: EmailDelivery = new ResendDelivery(config),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use(financialVisibility);
  app.use(
    helmet({
      strictTransportSecurity: config.production ? undefined : false,
      contentSecurityPolicy: {
        directives: {
          "worker-src": ["'self'", "blob:"],
          "script-src": ["'self'", "'wasm-unsafe-eval'"],
        },
      },
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set("X-Request-ID", res.locals.requestId);
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/email-webhooks/resend",notificationWebhook(pool,config.emailWebhookSecret));
  app.use("/api", (req, _res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      if (req.get("Origin") !== config.origin)
        throw new HttpError(403, "This request origin is not allowed.");
      if (!req.is("application/json"))
        throw new HttpError(415, "JSON request required.");
    }
    next();
  });
  const auth = authHttp(
    new AuthService(new AuthRepository(pool), config),
    config,
  );
  app.use(
    [
      "/api/boqs",
      "/api/cni",
      "/api/commercial",
      "/api/orders",
      "/api/coordinator",
      "/api/director",
      "/api/operations",
      "/api/departments",
      "/api/masters",
    ],
    auth.requireSession,
    workflowBoundary(pool),
  );
  app.use("/api/cni", express.json({limit:"32kb"}), cniHttp(pool, auth.requireSession));
  app.use("/api/ubl", express.json({limit:"16kb"}), ublHttp(new UblRepository(pool),auth.requireSession));
  const boqs = new BoqRepository(pool);
  app.use(
    "/api/survey-uploads",
    auth.requireSession,
    workflowBoundary(pool),
    express.json({ limit: "12mb" }),
    coordinatorRecords(pool),
    uploadHttp(boqs, auth.requireSession),
  );
  app.use(
    "/api/boqs",
    express.json({ limit: "128kb" }),
    coordinatorRecords(pool),
    boqHttp(boqs, auth.requireSession),
  );
  app.use(
    "/api/commercial",
    express.json({ limit: "128kb" }),
    coordinatorRecords(pool),
    commercialHttp(new CommercialRepository(pool), auth.requireSession),
  );
  app.use(
    "/api/orders",
    auth.requireSession,
    express.json({ limit: "12mb" }),
    coordinatorRecords(pool),
    ordersHttp(new OrdersRepository(pool), auth.requireSession),
  );
  app.use(
    "/api/design",
    express.json({ limit: "128kb" }),
    designHttp(new DesignRepository(pool), auth.requireSession),
  );
  // Customer imports are larger than ordinary forms; keep the general limit small.
  app.use("/api/masters/customer-import", express.json({ limit: "2mb" }));
  app.use("/api/inventory-reconciliation", express.json({limit:"12mb"}), inventoryHttp(new InventoryRepository(pool),auth.requireSession));
  app.use(express.json({ limit: "8kb" }));
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT singleton FROM admin_bootstrap LIMIT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use("/api/auth", auth.router);
  app.use("/api/backups", backupDevicesHttp(pool, auth.requireSession));
  app.use("/api/backups", backupsHttp(pool, auth.requireSession));
  app.use(
    "/api/accounts",
    accountsHttp(
      new AccountsService(
        new AccountsRepository(pool),
        new AuthRepository(pool),
        config,
        delivery,
      ),
      auth.requireSession,
    ),
  );
  app.use(
    "/api/operations",
    auth.requireSession,
    coordinatorRecords(pool),
    operationsHttp(new OperationsRepository(pool), auth.requireSession),
  );
  app.use(
    "/api/coordinator",
    auth.requireSession,
    coordinatorRecords(pool),
    coordinatorHttp(new CoordinatorRepository(pool), auth.requireSession),
  );
  app.use(
    "/api/director",
    directorHttp(new DirectorRepository(pool), auth.requireSession),
  );
  app.use(
    "/api/departments",
    departmentsHttp(new DepartmentRepository(pool), auth.requireSession),
  );
  app.use("/api/notifications",notificationsHttp(new NotificationsRepository(pool),auth.requireSession,{emailConfigured:delivery.configured,webhookConfigured:!!config.emailWebhookSecret}));
  app.use("/api/dashboard", dashboardRoutes(auth.requireSession));
  app.use(
    "/api/masters",
    mastersHttp(new MastersRepository(pool), auth.requireSession),
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Endpoint not found." });
  });
  if (webDirectory) {
    app.use(express.static(webDirectory, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res
        .set("Cache-Control", "no-store")
        .sendFile(resolve(webDirectory, "index.html"));
    });
  }
  const errors: ErrorRequestHandler = (err: unknown, req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof HttpError) {
      if (err.status === 429) res.set("Retry-After", "900");
      res.status(err.status).json({ message: err.message });
    } else if (err instanceof SyntaxError) {
      res.status(400).json({ message: "Invalid JSON request." });
    } else if (
      typeof err === "object" &&
      err &&
      "type" in err &&
      err.type === "entity.too.large"
    ) {
      res.status(413).json({ message: "Request is too large." });
    } else {
      // Do not emit request bodies, database URLs, tokens or SQL parameter values.
      const code = typeof err === "object" && err && "code" in err &&
        typeof err.code === "string" && /^[A-Z0-9_]{2,30}$/.test(err.code)
        ? err.code : undefined;
      console.error(JSON.stringify({
        event: "request.failed",
        requestId: res.locals.requestId,
        method: req.method,
        // Route patterns exclude URL/query values, bodies and credentials.
        route: req.route?.path ?? "unmatched",
        error: err instanceof Error ? err.name : "UnknownError",
        code,
      }));
      res.status(503).json({
        message: "Service temporarily unavailable. Please try again.",
        requestId: res.locals.requestId,
      });
    }
  };
  app.use(errors);
  return app;
}
