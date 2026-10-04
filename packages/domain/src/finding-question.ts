/** Explicit invocation keeps ordinary discussion and quoted mentions out of inference. */
export function parseFindingQuestion(
  body: string,
  appSlug: string,
): string | undefined {
  const text = body.trim();
  const command = /^\/holon\s+(?:ask|explain)\s+([\s\S]+)$/iu.exec(text);
  const mention = /^@([A-Za-z0-9-]+)(?:\[bot\])?\s+([\s\S]+)$/iu.exec(text);
  const question =
    command?.[1] ??
    (mention &&
    ["holon", appSlug.toLowerCase()].includes(mention[1]!.toLowerCase())
      ? mention[2]
      : undefined);
  const trimmed = question?.trim();
  return trimmed && trimmed.length <= 4000 ? trimmed : undefined;
}
