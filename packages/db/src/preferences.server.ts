import {
  admittedUserSchema,
  type AdmittedUser,
} from "@holon/contracts/dashboard";
import {
  personalPreferencesSchema,
  updatePreferencesInputSchema,
  type PersonalPreferences,
  type UpdatePreferencesInput,
} from "@holon/contracts/dashboard-preferences";

export type PreferencesErrorCode =
  | "invalid_preferences"
  | "user_not_admitted"
  | "storage_corrupted"
  | "storage_unavailable"
  | "command_unknown";
export class PreferencesError extends Error {
  constructor(readonly code: PreferencesErrorCode) {
    super(code);
    this.name = "PreferencesError";
  }
}

function validateActor(actor: AdmittedUser): AdmittedUser {
  const parsed = admittedUserSchema.safeParse(actor);
  if (!parsed.success) throw new PreferencesError("user_not_admitted");
  return parsed.data;
}

function parsePreferences(row: unknown): PersonalPreferences {
  const parsed = personalPreferencesSchema.safeParse(row);
  if (!parsed.success) throw new PreferencesError("storage_corrupted");
  return parsed.data;
}

/** The actor comes from authentication; its exact persisted authority is checked again in SQL. */
export function createPreferencesPersistence(database: D1Database) {
  return {
    async readPreferences(actor: AdmittedUser): Promise<PersonalPreferences> {
      const admitted = validateActor(actor);
      let row: unknown;
      try {
        row = await database
          .prepare(`
          SELECT p.locale, p.timezone
          FROM user u
          JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
          JOIN session s ON s.userId = u.id AND s.id = ?
            AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
          LEFT JOIN user_preference p ON p.user_id = u.id
          WHERE u.id = ?
        `)
          .bind(admitted.githubAccountId, admitted.sessionId, admitted.id)
          .first();
      } catch {
        throw new PreferencesError("storage_unavailable");
      }
      if (!row) throw new PreferencesError("user_not_admitted");
      return parsePreferences(row);
    },

    async updatePreferences(
      actor: AdmittedUser,
      input: UpdatePreferencesInput,
    ): Promise<UpdatePreferencesInput> {
      const admitted = validateActor(actor);
      const parsed = updatePreferencesInputSchema.safeParse(input);
      if (!parsed.success) throw new PreferencesError("invalid_preferences");
      let row: unknown;
      try {
        row = await database
          .prepare(`
          INSERT INTO user_preference (user_id, locale, timezone, updated_at)
          SELECT ?1, ?2, ?3, ?4
          WHERE EXISTS (
            SELECT 1 FROM user u
            JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?5
            JOIN session s ON s.userId = u.id AND s.id = ?6
              AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
            WHERE u.id = ?1
          )
          ON CONFLICT(user_id) DO UPDATE SET
            locale = excluded.locale, timezone = excluded.timezone, updated_at = excluded.updated_at
          RETURNING locale, timezone
        `)
          .bind(
            admitted.id,
            parsed.data.locale,
            parsed.data.timezone,
            Date.now(),
            admitted.githubAccountId,
            admitted.sessionId,
          )
          .first();
      } catch {
        throw new PreferencesError("command_unknown");
      }
      if (!row) throw new PreferencesError("user_not_admitted");
      const confirmed = updatePreferencesInputSchema.safeParse(row);
      if (!confirmed.success) throw new PreferencesError("storage_corrupted");
      return confirmed.data;
    },
  };
}
export type PreferencesPersistence = ReturnType<
  typeof createPreferencesPersistence
>;
