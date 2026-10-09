/** Stable lanes keep checkpoint identities and bounded concurrency independent of completion races. */
export function planReviewLanes(
  weights: readonly number[],
  concurrency: number,
): readonly (readonly number[])[] {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    weights.some((weight) => !Number.isFinite(weight) || weight < 0)
  )
    throw new TypeError("Invalid review scheduling input");
  const lanes = Array.from(
    { length: Math.min(concurrency, weights.length) },
    () => ({ work: 0, indices: [] as number[] }),
  );
  const maximum = Math.ceil(weights.length / concurrency);
  const work = weights
    .map((weight, index) => ({ weight, index }))
    .toSorted(
      (left, right) => right.weight - left.weight || left.index - right.index,
    );
  for (const item of work) {
    const next = lanes
      .filter((lane) => lane.indices.length < maximum)
      .toSorted(
        (left, right) =>
          left.work - right.work || lanes.indexOf(left) - lanes.indexOf(right),
      )[0]!;
    next.indices.push(item.index);
    next.work += item.weight;
  }
  return lanes.map((lane) => lane.indices);
}
