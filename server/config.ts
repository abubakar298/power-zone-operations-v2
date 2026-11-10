import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  ADMIN_SETUP_TOKEN: z.string().min(32).max(256),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  DATABASE_CA_FILE: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  // Database pool tuning. Values are passed to PostgreSQL as connection
  // startup options, so work_mem only accepts a plain size such as 8MB.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_WORK_MEM: z.string().regex(/^[1-9][0-9]{0,6}(kB|MB|GB)$/).default("4MB"),
  DATABASE_MAX_PARALLEL_WORKERS_PER_GATHER: z.coerce.number().int().min(0).max(8).default(0),
  EMAIL_DELIVERY_ENABLED: z.enum(["true", "false"]).default("true"),
  RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/).optional(),
  RESEND_API_KEY: z.string().min(10).optional(),
  EMAIL_FROM: z.email().optional(),
  EMAIL_REPLY_TO: z.email().optional(),
  EMAIL_FROM_NAME: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\r\n"<>]+$/)
    .optional(),
  EMAIL_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export interface Config {
  production: boolean;
  port: number;
  origin: string;
  databaseUrl: string;
  setupToken: string;
  databaseSsl: boolean;
  databaseCaFile?: string;
  trustProxyHops: number;
  databasePoolMax: number;
  databaseWorkMem: string;
  databaseParallelWorkersPerGather: number;
  sessionHours: number;
  emailDeliveryEnabled?: boolean;
  emailWebhookSecret?: string;
  emailApiKey?: string;
  emailFrom?: string;
  emailReplyTo?: string;
  emailFromName?: string;
  emailEncryptionKey?: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report field names, never values (URLs and setup tokens are secrets).
    throw new Error(
      `Invalid environment: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  const e = result.data;
  const url = new URL(e.APP_ORIGIN);
  if (url.origin !== e.APP_ORIGIN || url.username || url.password)
    throw new Error(
      "APP_ORIGIN must be an origin without a path or trailing slash",
    );
  if (e.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("Production requires HTTPS APP_ORIGIN");
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("APP_ORIGIN must use HTTP or HTTPS");
  return {
    production: e.NODE_ENV === "production",
    port: e.PORT,
    origin: url.origin,
    databaseUrl: e.DATABASE_URL,
    setupToken: e.ADMIN_SETUP_TOKEN,
    databaseSsl: e.DATABASE_SSL === "true",
    databaseCaFile: e.DATABASE_CA_FILE,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    databasePoolMax: e.DATABASE_POOL_MAX,
    databaseWorkMem: e.DATABASE_WORK_MEM,
    databaseParallelWorkersPerGather: e.DATABASE_MAX_PARALLEL_WORKERS_PER_GATHER,
    sessionHours: 12,
    emailDeliveryEnabled: e.EMAIL_DELIVERY_ENABLED === "true",
    emailWebhookSecret: e.RESEND_WEBHOOK_SECRET,
    emailApiKey: e.RESEND_API_KEY,
    emailFrom: e.EMAIL_FROM,
    emailReplyTo: e.EMAIL_REPLY_TO,
    emailFromName: e.EMAIL_FROM_NAME,
    emailEncryptionKey: e.EMAIL_TOKEN_ENCRYPTION_KEY,
  };
}
