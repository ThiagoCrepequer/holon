export class RepositoryPolicyConflictError extends Error {
  public constructor(
    message = "Both .github/holon.yml and .holon.yml exist at baseSha; this is an explicit configuration conflict",
  ) {
    super(message);
    this.name = "RepositoryPolicyConflictError";
  }
}

export class RepositoryPolicySyntaxError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryPolicySyntaxError";
  }
}

export class RepositoryPolicySchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryPolicySchemaError";
  }
}

export class RepositoryPolicyScopeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryPolicyScopeError";
  }
}

export class RepositoryPolicySecurityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryPolicySecurityError";
  }
}
