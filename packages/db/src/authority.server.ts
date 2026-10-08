import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
const authorityTable = sqliteTable("storage_authority", {
  singleton: integer("singleton").primaryKey(),
  authority: text("authority").notNull(),
});
export function authorityCheck(
  database: D1Database,
  expected: "identity" | "projection",
): () => Promise<void> {
  const orm = drizzle(database);
  return async () => {
    const rows = await orm.select().from(authorityTable).all();
    const row = rows[0];
    if (rows.length !== 1 || row?.singleton !== 1 || row.authority !== expected)
      throw new Error("storage_authority_mismatch");
  };
}
