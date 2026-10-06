/** Official Semente paths, with semantic colors from the canonical brand tokens. */
export function BrandMark({ decorative = false }: { decorative?: boolean }) {
  return (
    <svg
      viewBox="8.5 10.5 80 80"
      className="holon-brand"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "Holon"}
      focusable="false"
    >
      <path
        d="M17 69C11 39 37 17 80 18c5 35-12 64-43 65-10 0-17-5-20-14Z"
        fill="none"
        stroke="var(--holon-brand-shell)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M42 65c-5-15 7-30 24-29 3 16-10 31-24 29Z"
        fill="var(--holon-brand-core)"
      />
    </svg>
  );
}
