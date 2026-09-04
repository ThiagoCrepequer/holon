import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from "jose";

export interface AccessIdentity {
  readonly email: string;
  readonly sub: string;
  readonly identityProvider?: string | undefined;
}

export interface AccessValidationConfig {
  readonly teamName: string;
  readonly expectedAudience: string;
  readonly authorizedEmailDomain: string;
  readonly customJwkSet?: JWTVerifyGetKey | undefined;
}

const jwkSetCache = new Map<string, JWTVerifyGetKey>();

export function getOrCreateRemoteJWKSet(teamName: string): JWTVerifyGetKey {
  const cached = jwkSetCache.get(teamName);
  if (cached) {
    return cached;
  }

  const certsUrl = new URL(
    `https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`,
  );
  const jwkSet = createRemoteJWKSet(certsUrl, {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000, // 10 minutes
  });

  jwkSetCache.set(teamName, jwkSet);
  return jwkSet;
}

export function clearJwkSetCache(): void {
  jwkSetCache.clear();
}

export class AccessAuthError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "AccessAuthError";
  }

  public toResponse(): Response {
    return new Response(JSON.stringify({ error: this.userMessage }), {
      status: this.statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  }
}

export async function validateAccessJwt(
  request: Request,
  config: AccessValidationConfig,
): Promise<AccessIdentity> {
  const teamName = config.teamName.trim();
  const expectedAudience = config.expectedAudience.trim();
  const authorizedEmailDomain = config.authorizedEmailDomain
    .trim()
    .toLowerCase();
  if (!teamName || !expectedAudience || !authorizedEmailDomain) {
    throw new AccessAuthError(403, "Access configuration incomplete");
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || token.trim() === "") {
    throw new AccessAuthError(
      401,
      "Missing Cloudflare Access assertion header",
    );
  }

  let keySet = config.customJwkSet;
  if (!keySet) {
    keySet = getOrCreateRemoteJWKSet(teamName);
  }

  const verifyOptions: JWTVerifyOptions = {
    algorithms: ["RS256"],
    issuer: `https://${teamName}.cloudflareaccess.com`,
    audience: expectedAudience,
  };

  let verified;
  try {
    verified = await jwtVerify(token, keySet, verifyOptions);
  } catch {
    throw new AccessAuthError(401, "Invalid Cloudflare Access assertion");
  }

  const payload = verified.payload;

  if (payload.type === "app") {
    throw new AccessAuthError(
      403,
      "Service tokens are not authorized for interactive console",
    );
  }

  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    throw new AccessAuthError(
      403,
      "Assertion does not contain a valid email address",
    );
  }

  const requiredDomain = `@${authorizedEmailDomain}`;
  if (!email.endsWith(requiredDomain)) {
    throw new AccessAuthError(
      403,
      "Email domain is not authorized to access internal console",
    );
  }

  const identityProvider =
    typeof payload.idp === "object" && payload.idp && "type" in payload.idp
      ? String(payload.idp.type)
      : undefined;

  return {
    email,
    sub: typeof payload.sub === "string" ? payload.sub : email,
    identityProvider,
  };
}
