import { pgTable, text, serial, integer, boolean, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===
export const terminals = pgTable("terminals", {
  id: text("id").primaryKey(), // terminal_id
  login: integer("login").notNull(),
  server: text("server").notNull(),
  active: boolean("active").default(false),
  algoActive: boolean("algo_active").default(false),
  uptimeHours: integer("uptime_hours").default(0),
  balance: doublePrecision("balance").default(0),
  equity: doublePrecision("equity").default(0),
  growthPercent: doublePrecision("growth_percent").default(0),
  lastHeartbeat: timestamp("last_heartbeat").defaultNow(),
});

export const heartbeats = pgTable("heartbeats", {
  id: serial("id").primaryKey(),
  terminalId: text("terminal_id").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  equity: doublePrecision("equity").notNull(),
  balance: doublePrecision("balance").notNull(),
});

// === RELATIONS ===
export const terminalsRelations = relations(terminals, ({ many }) => ({
  heartbeats: many(heartbeats),
}));

export const heartbeatsRelations = relations(heartbeats, ({ one }) => ({
  terminal: one(terminals, {
    fields: [heartbeats.terminalId],
    references: [terminals.id],
  }),
}));

// === BASE SCHEMAS ===
export const insertTerminalSchema = createInsertSchema(terminals);
export const insertHeartbeatSchema = createInsertSchema(heartbeats).omit({ id: true });

// === EXPLICIT API CONTRACT TYPES ===
export type Terminal = typeof terminals.$inferSelect;
export type Heartbeat = typeof heartbeats.$inferSelect;

export type CurvePoint = {
  timestamp: string;
  equity: number;
  balance: number;
};
