/** Local planning experiment; durable production model quotas remain equal. */
export function compareEnvelopeAllocations(
  minimumBytes: readonly number[],
  totalBytes: number,
) {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 1 ||
    minimumBytes.length === 0 ||
    minimumBytes.some((value) => !Number.isSafeInteger(value) || value < 1)
  )
    throw new TypeError("Invalid envelope allocation");
  const minimumTotal = minimumBytes.reduce((sum, value) => sum + value, 0);
  const equal = minimumBytes.map(() =>
    Math.floor(totalBytes / minimumBytes.length),
  );
  // Preserve every minimum before distributing remaining bytes by observed envelope size.
  const remaining = Math.max(0, totalBytes - minimumTotal);
  const weighted = minimumBytes.map(
    (value) => value + Math.floor((remaining * value) / minimumTotal),
  );
  return {
    equal,
    weighted: minimumTotal <= totalBytes ? weighted : undefined,
    feasible: minimumTotal <= totalBytes,
    equalRejected: minimumBytes.flatMap((value, index) =>
      value > equal[index]! ? [index] : [],
    ),
    minimumTotal,
    unallocated:
      minimumTotal <= totalBytes
        ? totalBytes - weighted.reduce((sum, value) => sum + value, 0)
        : totalBytes,
  };
}
