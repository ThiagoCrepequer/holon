export const modelSpendPolicy = Object.freeze({
  limitUSD: 0.5,
  inputNanodollarsPerToken: 150,
  outputNanodollarsPerToken: 600,
  templateTokenAllowance: 2048,
  routeAttempts: 2,
  marginPercent: 125,
});

export interface ModelSpendRecord {
  readonly id: string;
  readonly reservedNanodollars: number;
  readonly chargedNanodollars?: number | undefined;
}

/** One campaign budget across runs. Missing usage retains both possible route attempts. */
export class LiveModelSpend {
  private readonly records = new Map<string, ModelSpendRecord>();

  constructor(
    records: readonly ModelSpendRecord[],
    private readonly limitNanodollars = modelSpendPolicy.limitUSD *
      1_000_000_000,
  ) {
    if (!Number.isSafeInteger(limitNanodollars) || limitNanodollars <= 0)
      throw new RangeError("Invalid campaign spending limit");
    for (const record of records) {
      if (
        this.records.has(record.id) ||
        !record.id ||
        !Number.isSafeInteger(record.reservedNanodollars) ||
        record.reservedNanodollars <= 0 ||
        (record.chargedNanodollars !== undefined &&
          (!Number.isSafeInteger(record.chargedNanodollars) ||
            record.chargedNanodollars < 0))
      )
        throw new RangeError("Invalid spend record");
      this.records.set(record.id, { ...record });
    }
  }

  reserve(id: string, inputBytes: number, maxOutputTokens: number): boolean {
    if (
      !id ||
      ![inputBytes, maxOutputTokens].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw new RangeError("Invalid spend reservation");
    const reservedNanodollars = Math.ceil(
      (((inputBytes + modelSpendPolicy.templateTokenAllowance) *
        modelSpendPolicy.inputNanodollarsPerToken +
        maxOutputTokens * modelSpendPolicy.outputNanodollarsPerToken) *
        modelSpendPolicy.routeAttempts *
        modelSpendPolicy.marginPercent) /
        100,
    );
    if (
      this.records.has(id) ||
      this.snapshot().exposureNanodollars + reservedNanodollars >
        this.limitNanodollars
    )
      return false;
    this.records.set(id, { id, reservedNanodollars });
    return true;
  }

  settle(id: string, reportedCostUSD: number): void {
    const record = this.records.get(id);
    const chargedNanodollars = Math.ceil(
      (reportedCostUSD * 1_000_000_000 * modelSpendPolicy.marginPercent) / 100,
    );
    if (
      !record ||
      !Number.isSafeInteger(chargedNanodollars) ||
      chargedNanodollars < 0 ||
      (record.chargedNanodollars !== undefined &&
        record.chargedNanodollars !== chargedNanodollars)
    )
      throw new RangeError("Invalid spend settlement");
    this.records.set(id, { ...record, chargedNanodollars });
  }

  snapshot() {
    return {
      policy: modelSpendPolicy,
      records: [...this.records.values()],
      exposureNanodollars: [...this.records.values()].reduce(
        (sum, record) =>
          sum + (record.chargedNanodollars ?? record.reservedNanodollars),
        0,
      ),
    };
  }
}
