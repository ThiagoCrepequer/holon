export const assetBudget: Readonly<{ js: number; css: number; fonts: number }>;
export function assertAssetBudget(measured: {
  js: number;
  css: number;
  fonts: number;
}): void;
export function measureAssets(directory: string): Promise<{
  measured: { js: number; css: number; fonts: number };
  assets: Record<string, { kind: "js" | "css" | "fonts"; bytes: number }>;
}>;
export function percentile(samples: number[], fraction: number): number;

export const browserBudget: Readonly<{
  ssr: number;
  interaction: number;
  lcp: number;
  cls: number;
  inp: number;
  dom: number;
}>;
export function assertBrowserBudget(
  route: {
    cold: { p95: number };
    warm: { p95: number };
    lcp_p75: number;
    cls_p75: number;
    maxDOM: number;
  },
  interactions: {
    filter: { p95: number };
    refresh: { p95: number };
    inp: number;
  },
): void;
