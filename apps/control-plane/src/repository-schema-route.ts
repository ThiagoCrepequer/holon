import schema from "../../../docs/contracts/holon.schema.json";

const body = `${JSON.stringify(schema, null, 2)}\n`;
let etag: Promise<string> | undefined;
export async function repositorySchemaResponse(
  request: Request,
): Promise<Response> {
  etag ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(body))
    .then(
      (hash) =>
        `"${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`,
    );
  const tag = await etag;
  const headers = {
    "Content-Type": "application/schema+json; charset=utf-8",
    "Cache-Control": "public, max-age=300, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    ETag: tag,
    "X-Content-Type-Options": "nosniff",
  };
  const condition = request.headers.get("If-None-Match");
  if (
    condition
      ?.split(",")
      .some(
        (value) =>
          value.trim().replace(/^W\//u, "") === tag || value.trim() === "*",
      )
  )
    return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
