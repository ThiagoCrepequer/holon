import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AccessAuthError,
  clearJwkSetCache,
  getOrCreateRemoteJWKSet,
  validateAccessJwt,
} from "../workers/security/access-jwt.js";

describe("Cloudflare Access JWT validator", () => {
  let publicKeyJwk: JWK;
  let privateKey: CryptoKey | Uint8Array;
  let localJwkSet: JWTVerifyGetKey;

  beforeAll(async () => {
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    publicKeyJwk = await exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = "test-key-1";
    publicKeyJwk.alg = "RS256";
    publicKeyJwk.use = "sig";
    localJwkSet = createLocalJWKSet({ keys: [publicKeyJwk] });
  });

  async function createSignedToken(
    payload: Record<string, unknown>,
    options?: {
      kid?: string;
      issuer?: string;
      audience?: string;
      expiresIn?: string;
    },
  ) {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: options?.kid ?? "test-key-1" })
      .setIssuedAt();

    jwt.setIssuer(options?.issuer ?? "https://test-team.cloudflareaccess.com");
    jwt.setAudience(options?.audience ?? "test-audience");
    jwt.setExpirationTime(options?.expiresIn ?? "1h");

    return jwt.sign(privateKey);
  }

  function validConfig() {
    return {
      teamName: "test-team",
      expectedAudience: "test-audience",
      authorizedEmailDomain: "corp.example.com",
      customJwkSet: localJwkSet,
    };
  }

  it("throws 401 when cf-access-jwt-assertion header is missing", async () => {
    const request = new Request("https://admin.example.com/");
    await expect(validateAccessJwt(request, validConfig())).rejects.toThrow(
      AccessAuthError,
    );

    try {
      await validateAccessJwt(request, validConfig());
    } catch (err) {
      expect(err instanceof AccessAuthError).toBe(true);
      expect((err as AccessAuthError).statusCode).toBe(401);
      const resp = (err as AccessAuthError).toResponse();
      expect(resp.status).toBe(401);
      expect(resp.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("throws 401 when token signature is invalid", async () => {
    const request = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": "invalid.jwt.token" },
    });
    await expect(validateAccessJwt(request, validConfig())).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("throws 403 when session is an automated service token (type: 'app')", async () => {
    const token = await createSignedToken({
      type: "app",
      email: "bot@corp.example.com",
      sub: "bot-sub-123",
    });

    const request = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": token },
    });

    try {
      await validateAccessJwt(request, validConfig());
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as AccessAuthError).statusCode).toBe(403);
      expect((err as AccessAuthError).userMessage).toContain(
        "Service tokens are not authorized",
      );
    }
  });

  it("throws 403 when email is missing or domain is unauthorized", async () => {
    const tokenNoEmail = await createSignedToken({
      sub: "user-1",
    });

    const req1 = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": tokenNoEmail },
    });

    await expect(validateAccessJwt(req1, validConfig())).rejects.toThrow(
      AccessAuthError,
    );

    const tokenWrongDomain = await createSignedToken({
      email: "intruder@gmail.com",
      sub: "intruder-1",
    });

    const req2 = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": tokenWrongDomain },
    });

    try {
      await validateAccessJwt(req2, validConfig());
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as AccessAuthError).statusCode).toBe(403);
      expect((err as AccessAuthError).userMessage).toContain(
        "domain is not authorized",
      );
    }
  });

  it("successfully validates human session with authorized email domain", async () => {
    const token = await createSignedToken({
      email: "engineer@corp.example.com",
      sub: "user-sub-456",
      idp: { type: "google" },
    });

    const request = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": token },
    });

    const identity = await validateAccessJwt(request, validConfig());

    expect(identity.email).toBe("engineer@corp.example.com");
    expect(identity.sub).toBe("user-sub-456");
    expect(identity.identityProvider).toBe("google");
  });

  it("caches remote JWKSet and allows clearing cache", () => {
    clearJwkSetCache();
    const jwkSet1 = getOrCreateRemoteJWKSet("test-team");
    const jwkSet2 = getOrCreateRemoteJWKSet("test-team");
    expect(jwkSet1).toBe(jwkSet2);
    clearJwkSetCache();
  });

  it("fails closed when any required Access policy is missing", async () => {
    const token = await createSignedToken({
      email: "user@example.com",
      sub: "sub-1",
    });
    const request = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": token },
    });
    for (const config of [
      { ...validConfig(), teamName: "" },
      { ...validConfig(), expectedAudience: "" },
      { ...validConfig(), authorizedEmailDomain: "" },
    ]) {
      await expect(validateAccessJwt(request, config)).rejects.toMatchObject({
        statusCode: 403,
        userMessage: "Access configuration incomplete",
      });
    }
  });

  it("validates issuer and audience when expectedAudience and teamName are provided", async () => {
    const token = await createSignedToken(
      { email: "engineer@corp.example.com", sub: "user-456" },
      {
        issuer: "https://my-team.cloudflareaccess.com",
        audience: "my-aud-123",
      },
    );
    const request = new Request("https://admin.example.com/", {
      headers: { "cf-access-jwt-assertion": token },
    });
    const identity = await validateAccessJwt(request, {
      customJwkSet: localJwkSet,
      teamName: "my-team",
      expectedAudience: "my-aud-123",
      authorizedEmailDomain: "corp.example.com",
    });
    expect(identity.email).toBe("engineer@corp.example.com");
  });
});
