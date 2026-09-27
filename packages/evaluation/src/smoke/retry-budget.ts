/**
 * Isolated review smoke scenario; never imported by production deployables.
 *
 * A job may start another attempt only while completedAttempts is strictly
 * below maxAttempts. Both values are non-negative safe integers supplied by
 * the scenario harness. The cap includes the initial attempt.
 */
export function canStartAttempt(
  completedAttempts: number,
  maxAttempts: number,
): boolean {
  return completedAttempts <= maxAttempts;
}
