/** Deployment configuration survives identity D1 restore. Unknown/missing means closed. */
export function recoveryMode(
  value: unknown,
): "active" | "closed" | "rebuilding" {
  return value === "active" || value === "rebuilding" ? value : "closed";
}
