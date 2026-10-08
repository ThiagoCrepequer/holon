import { vi } from "vitest";

// Controlled external GitHub fixture reused from the M0 proof, never a product auth substitute.
export interface GitHubIdentity {
  id: number;
  email: string;
  verified?: boolean;
}

export function fakeGitHub(
  options: { enforcePkceDowngrade?: boolean; now?: () => number } = {},
) {
  const codes = new Map<
    string,
    { identity: GitHubIdentity; authorizationURL: URL; expiresAt: number }
  >();
  const tokenRequests: {
    code: string;
    verifier: string | null;
    clientId: string | null;
    redirectURI: string | null;
  }[] = [];
  let acceptedExchanges = 0;
  let rejectedPkce = 0;
  const identities = new Map<string, GitHubIdentity>();
  const consumed = new Set<string>();
  let exchanges = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.href === "https://github.com/login/oauth/access_token" &&
      request.method === "POST"
    ) {
      exchanges += 1;
      const body = await request.formData();
      const submittedCode = body.get("code");
      const code = typeof submittedCode === "string" ? submittedCode : "";
      const grant = codes.get(code);
      const verifier = body.get("code_verifier");
      const clientId = body.get("client_id");
      const redirectURI = body.get("redirect_uri");
      tokenRequests.push({
        code,
        verifier: typeof verifier === "string" ? verifier : null,
        clientId: typeof clientId === "string" ? clientId : null,
        redirectURI: typeof redirectURI === "string" ? redirectURI : null,
      });
      if (
        !grant ||
        (options.now?.() ?? Date.now()) >= grant.expiresAt ||
        consumed.has(code)
      )
        return Response.json({ error: "bad_verification_code" });
      const params = grant.authorizationURL.searchParams;
      if (
        body.get("client_id") !== params.get("client_id") ||
        body.get("client_secret") !== "synthetic-client-secret" ||
        body.get("redirect_uri") !== params.get("redirect_uri")
      )
        return Response.json({ error: "bad_verification_code" });
      const expectedChallenge = params.get("code_challenge");
      if (expectedChallenge) {
        const validFormat =
          typeof verifier === "string" &&
          /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
        const hash = validFormat
          ? new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(verifier),
              ),
            )
          : null;
        const derived = hash
          ? btoa(String.fromCharCode(...hash))
              .replaceAll("+", "-")
              .replaceAll("/", "_")
              .replace(/=+$/, "")
          : null;
        if (
          params.get("code_challenge_method") !== "S256" ||
          derived !== expectedChallenge
        ) {
          rejectedPkce += 1;
          return Response.json({ error: "bad_verification_code" });
        }
      } else if (verifier !== null && options.enforcePkceDowngrade !== false) {
        // RFC 9700 section 4.8.2 server obligation, not an observed remote GitHub result.
        rejectedPkce += 1;
        return Response.json({ error: "bad_verification_code" });
      }
      // Model a server's atomic single-use claim AFTER async cryptographic validation.
      // No await may separate this check and add; this is only the external provider fixture.
      if (consumed.has(code))
        return Response.json({ error: "bad_verification_code" });
      consumed.add(code);
      acceptedExchanges += 1;
      const identity = grant.identity;
      const access = `synthetic-access-${code}`;
      identities.set(access, identity);
      return Response.json({
        access_token: access,
        refresh_token: `synthetic-refresh-${code}`,
        expires_in: 28800,
        refresh_token_expires_in: 15724800,
        token_type: "bearer",
        scope: "",
      });
    }
    const identity = identities.get(
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "",
    );
    if (
      url.origin === "https://api.github.com" &&
      request.method === "GET" &&
      identity
    ) {
      if (url.pathname === "/user")
        return Response.json({
          id: identity.id,
          login: `synthetic-${identity.id}`,
          name: "Synthetic person",
          email: null,
          avatar_url: "https://avatars.githubusercontent.com/synthetic",
        });
      if (url.pathname === "/user/emails")
        return Response.json([
          {
            email: identity.email,
            verified: identity.verified ?? true,
            primary: true,
            visibility: "private",
          },
        ]);
    }
    throw new Error(
      "Unexpected outbound request: network is denied by the proof fixture",
    );
  });
  return {
    authorize(code: string, identity: GitHubIdentity, authorizationURL: URL) {
      codes.set(code, {
        identity,
        authorizationURL: new URL(authorizationURL),
        expiresAt: (options.now?.() ?? Date.now()) + 600000,
      });
    },
    get tokenRequests() {
      return tokenRequests;
    },
    get acceptedExchanges() {
      return acceptedExchanges;
    },
    get rejectedPkce() {
      return rejectedPkce;
    },
    get exchanges() {
      return exchanges;
    },
  };
}

export class CookieJar {
  private readonly values = new Map<string, string>();
  capture(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      if (!pair) continue;
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (value) this.values.set(name, value);
      else this.values.delete(name);
    }
  }
  headers(): Headers {
    return new Headers({
      Cookie: [...this.values].map(([k, v]) => `${k}=${v}`).join("; "),
    });
  }
  hasSession(): boolean {
    return [...this.values.keys()].some((name) =>
      name.endsWith("session_token"),
    );
  }
}
