import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monitoringUsers = pgTable("monitoring_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 80 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const monitoringSessions = pgTable("monitoring_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => monitoringUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const monitoringStations = pgTable("monitoring_stations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  stationType: varchar("station_type", { length: 80 }).notNull(),
  deviceStatus: varchar("device_status", { length: 20 }).notNull().default("working"),
  temperature: doublePrecision("temperature").notNull().default(18),
  humidity: doublePrecision("humidity").notNull().default(62),
  smoke: doublePrecision("smoke").notNull().default(12),
  risk: integer("risk").notNull().default(24),
  riskLevel: varchar("risk_level", { length: 20 }).notNull().default("low"),
  lastMeasuredAt: timestamp("last_measured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  scenario: varchar("scenario", { length: 20 }).notNull().default("normal"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const monitoringMeasurements = pgTable("monitoring_measurements", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id")
    .notNull()
    .references(() => monitoringStations.id, { onDelete: "cascade" }),
  temperature: doublePrecision("temperature").notNull(),
  humidity: doublePrecision("humidity").notNull(),
  smoke: doublePrecision("smoke").notNull(),
  risk: integer("risk").notNull(),
  riskLevel: varchar("risk_level", { length: 20 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const monitoringAlerts = pgTable("monitoring_alerts", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id")
    .notNull()
    .references(() => monitoringStations.id, { onDelete: "cascade" }),
  severity: varchar("severity", { length: 20 }).notNull(),
  risk: integer("risk").notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("new"),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  handledByUserId: integer("handled_by_user_id").references(() => monitoringUsers.id, {
    onDelete: "set null",
  }),
});

export const monitoringSettings = pgTable("monitoring_settings", {
  id: integer("id").primaryKey().default(1),
  alertThreshold: integer("alert_threshold").notNull().default(60),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertMonitoringUserSchema = createInsertSchema(monitoringUsers).omit({
  id: true,
  createdAt: true,
});
export const insertMonitoringStationSchema = createInsertSchema(monitoringStations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});
export const insertMonitoringMeasurementSchema = createInsertSchema(
  monitoringMeasurements,
).omit({ id: true, recordedAt: true });
export const insertMonitoringAlertSchema = createInsertSchema(monitoringAlerts).omit({
  id: true,
  createdAt: true,
});
export const insertMonitoringSettingSchema = createInsertSchema(monitoringSettings).omit({
  updatedAt: true,
});

export type MonitoringUser = typeof monitoringUsers.$inferSelect;
export type InsertMonitoringUser = z.infer<typeof insertMonitoringUserSchema>;
export type MonitoringSession = typeof monitoringSessions.$inferSelect;
export type MonitoringStation = typeof monitoringStations.$inferSelect;
export type InsertMonitoringStation = z.infer<typeof insertMonitoringStationSchema>;
export type MonitoringMeasurement = typeof monitoringMeasurements.$inferSelect;
export type InsertMonitoringMeasurement = z.infer<
  typeof insertMonitoringMeasurementSchema
>;
export type MonitoringAlert = typeof monitoringAlerts.$inferSelect;
export type InsertMonitoringAlert = z.infer<typeof insertMonitoringAlertSchema>;
export type MonitoringSetting = typeof monitoringSettings.$inferSelect;
export type InsertMonitoringSetting = z.infer<typeof insertMonitoringSettingSchema>;
