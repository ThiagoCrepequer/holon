import type { AdmittedUser } from "@holon/contracts/dashboard";
import type {
  PersonalPreferences,
  UpdatePreferencesInput,
} from "@holon/contracts/dashboard-preferences";

/** Personal settings require the exact admitted session; workspace ownership does not grant access. */
export interface PersonalPreferencesPort {
  readPreferences(actor: AdmittedUser): Promise<PersonalPreferences>;
  updatePreferences(
    actor: AdmittedUser,
    input: UpdatePreferencesInput,
  ): Promise<UpdatePreferencesInput>;
}
