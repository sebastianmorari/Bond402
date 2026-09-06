import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const bond402UsageTable = pgTable("bond402_usage", {
  userId: text("user_id").primaryKey(),
  plan: text("plan").notNull().default("FREE"),
  usedChecks: integer("used_checks").notNull().default(0),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
});

export type Bond402UsageRow = typeof bond402UsageTable.$inferSelect;