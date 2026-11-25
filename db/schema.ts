import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  boolean,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/* ── ARGUS domain model (Master Build Document v1.0, Part 6, condensed) ────── */

export const targets = mysqlTable("targets", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  domain: varchar("domain", { length: 255 }).notNull(),
  // range = ARGUS Range (demo). production gated behind counsel review (Gate G4).
  environment: mysqlEnum("environment", ["range", "production"])
    .default("range")
    .notNull(),
  verification: mysqlEnum("verification", ["unverified", "pending", "verified"])
    .default("unverified")
    .notNull(),
  verifyMethod: varchar("verifyMethod", { length: 32 }),
  verifyToken: varchar("verifyToken", { length: 64 }),
  isCdn: boolean("isCdn").default(false).notNull(),
  originVerified: boolean("originVerified").default(false).notNull(),
  scopeLocked: boolean("scopeLocked").default(false).notNull(),
  scopeHash: varchar("scopeHash", { length: 64 }),
  city: varchar("city", { length: 60 }),
  industry: varchar("industry", { length: 60 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Target = typeof targets.$inferSelect;

export const jobs = mysqlTable("jobs", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  targetId: bigint("targetId", { mode: "number", unsigned: true }).notNull(),
  state: mysqlEnum("state", [
    "queued",
    "scouting",
    "adjudicating",
    "reporting",
    "completed",
    "stopped",
    "failed",
  ])
    .default("queued")
    .notNull(),
  stopReason: varchar("stopReason", { length: 120 }),
  progress: int("progress").default(0).notNull(),
  requests: int("requests").default(0).notNull(),
  maxRequests: int("maxRequests").default(300).notNull(),
  rps: int("rps").default(5).notNull(),
  rulesetVersion: varchar("rulesetVersion", { length: 20 })
    .default("2026.11")
    .notNull(),
  isDemo: boolean("isDemo").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
});

export type Job = typeof jobs.$inferSelect;

export const findings = mysqlTable("findings", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  jobId: bigint("jobId", { mode: "number", unsigned: true }).notNull(),
  targetId: bigint("targetId", { mode: "number", unsigned: true }).notNull(),
  detectorId: varchar("detectorId", { length: 12 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  severity: mysqlEnum("severity", ["critical", "high", "medium", "low", "info"])
    .default("info")
    .notNull(),
  // Three-state evidence: deterministic adjudication only, never a scanner guess.
  state: mysqlEnum("state", ["reproduced", "not_reproduced", "inconclusive"])
    .notNull(),
  lifecycle: mysqlEnum("lifecycle", [
    "open",
    "acknowledged",
    "fix_claimed",
    "verified_fixed",
    "still_open",
  ])
    .default("open")
    .notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  endpoint: varchar("endpoint", { length: 255 }),
  summary: text("summary"),
  evidence: text("evidence"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Finding = typeof findings.$inferSelect;

export const jobEvents = mysqlTable("job_events", {
  id: serial("id").primaryKey(),
  jobId: bigint("jobId", { mode: "number", unsigned: true }).notNull(),
  agent: mysqlEnum("agent", [
    "scout",
    "hacker",
    "watcher",
    "reporter",
    "proxy",
    "system",
  ]).notNull(),
  kind: mysqlEnum("kind", ["info", "metric", "threshold", "stop", "signal"])
    .default("info")
    .notNull(),
  message: varchar("message", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobEvent = typeof jobEvents.$inferSelect;

export const detectionEvents = mysqlTable("detection_events", {
  id: serial("id").primaryKey(),
  jobId: bigint("jobId", { mode: "number", unsigned: true }).notNull(),
  // Part 10: external signals / connector-confirmed / not observable. Never fabricate.
  tier: mysqlEnum("tier", ["external", "confirmed", "not_observable"]).notNull(),
  source: varchar("source", { length: 60 }).notNull(),
  message: varchar("message", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DetectionEvent = typeof detectionEvents.$inferSelect;

export const reports = mysqlTable("reports", {
  id: serial("id").primaryKey(),
  jobId: bigint("jobId", { mode: "number", unsigned: true }).notNull(),
  lang: varchar("lang", { length: 8 }).default("en").notNull(),
  manifestHash: varchar("manifestHash", { length: 64 }).notNull(),
  signature: varchar("signature", { length: 128 }).notNull(),
  summaryJson: text("summaryJson").notNull(),
  rulesetVersion: varchar("rulesetVersion", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Report = typeof reports.$inferSelect;

// Append-only by convention: no update/delete paths exist anywhere in the API.
export const auditLog = mysqlTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  detail: text("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditEntry = typeof auditLog.$inferSelect;
