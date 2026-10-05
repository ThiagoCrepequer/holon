export const hostileText =
  '</script><script>globalThis.proofXss = true</script><svg onload="globalThis.proofXss = true">';
export interface Identity {
  user: string;
  locale: "en" | "pt-BR";
  zone: string;
}
export interface Dataset {
  user: string;
  resource: string;
  term: string;
  page: number;
  observedAt: number;
  text: string;
}
export function parameters(url: URL) {
  const page = Number(url.searchParams.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Response("invalid page", { status: 400 });
  return {
    resource: url.pathname.split("/").at(-1) ?? "a",
    term: url.searchParams.get("q") ?? "",
    page,
  };
}
export function key(identity: Identity, input: ReturnType<typeof parameters>) {
  return [
    "proof-dataset",
    identity.user,
    input.resource,
    input.term,
    input.page,
  ] as const;
}
