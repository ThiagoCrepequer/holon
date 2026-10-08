export type TenancyErrorCode =
  | "user_not_admitted"
  | "operation_conflict"
  | "command_unknown"
  | "personal_workspace_provision_failed"
  | "team_workspace_creation_failed"
  | "storage_corrupted"
  | "reauth_required"
  | "governance_denied"
  | "member_not_found"
  | "invalid_role_transition";

export class TenancyError extends Error {
  readonly code: TenancyErrorCode;

  constructor(code: TenancyErrorCode) {
    super(code);
    this.name = "TenancyError";
    this.code = code;
  }
}
