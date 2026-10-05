import {
  hostileText,
  parameters,
  type Dataset,
  type Identity,
} from "./fixture.js";
export const serverOnlyMarker = "HOLON_SERVER_ONLY_CANARY";
export function identityFor(request: Request): Identity {
  const user = request.headers.get("x-proof-user");
  if (user && user !== "alice" && user !== "bob")
    throw new Error(serverOnlyMarker);
  return {
    user: request.headers.get("x-proof-user") === "bob" ? "bob" : "alice",
    locale: request.headers.get("x-proof-locale") === "pt-BR" ? "pt-BR" : "en",
    zone:
      request.headers.get("x-proof-zone") === "America/Sao_Paulo"
        ? "America/Sao_Paulo"
        : "UTC",
  };
}
export function readAuthorized(request: Request): Dataset {
  const identity = identityFor(request);
  const input = parameters(new URL(request.url));
  return {
    user: identity.user,
    ...input,
    observedAt: Date.now(),
    text: hostileText,
  };
}
