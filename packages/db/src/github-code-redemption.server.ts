// GitHub.com documents a 10-minute OAuth web code lifetime; retain reservations for
// 24 hours. This is a tombstone, never a retry lease or a reusable credential.
const retentionSeconds = 86400;
const databaseNow = "CAST(strftime('%s', 'now') AS INTEGER)";

function expiredMarkers(database: D1Database): D1PreparedStatement {
  // Indexed, bounded cleanup; a dormant database is drained by maintenance.
  return database.prepare(`DELETE FROM github_code_redemption WHERE fingerprint IN (
    SELECT fingerprint FROM github_code_redemption WHERE expires_at <= ${databaseNow}
    ORDER BY expires_at, fingerprint LIMIT 100)`);
}

interface StatementResult {
  success: true;
  results: unknown[];
}
function isStatementResult(value: unknown): value is StatementResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true &&
    "results" in value &&
    Array.isArray(value.results)
  );
}

export async function pruneExpiredGithubCodes(
  database: D1Database,
): Promise<void> {
  const result = await expiredMarkers(database).run();
  if (!result.success) throw new Error("OAuth reservation cleanup failed");
}

export async function reserveGithubCode(
  database: D1Database,
  clientId: string,
  code: string,
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        "oauth-code-redemption",
        "https://github.com",
        clientId,
        code,
      ]),
    ),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // D1.batch makes pruning + reservation one transaction and one round trip.
  // A failed/ambiguous binding response must never authorize a token request.
  const results: unknown = await database.batch([
    expiredMarkers(database),
    database
      .prepare(`INSERT INTO github_code_redemption (fingerprint, expires_at)
      VALUES (?, ${databaseNow} + ?) ON CONFLICT(fingerprint) DO NOTHING RETURNING fingerprint`)
      .bind(fingerprint, retentionSeconds),
  ]);
  if (
    !Array.isArray(results) ||
    results.length !== 2 ||
    !isStatementResult(results[0]) ||
    !isStatementResult(results[1])
  ) {
    throw new Error("Invalid OAuth reservation result");
  }
  const rows = results[1].results;
  if (rows.length === 0) return false;
  const row: unknown = rows[0];
  if (
    rows.length !== 1 ||
    typeof row !== "object" ||
    row === null ||
    !("fingerprint" in row) ||
    row.fingerprint !== fingerprint
  ) {
    throw new Error("Invalid OAuth reservation result");
  }
  return true;
}
