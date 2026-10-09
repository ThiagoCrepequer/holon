import type { ReactNode } from "react";

/** Safari does not consistently scroll a focused pre with arrow keys. */
export function ReviewCode({ children }: { children: ReactNode }) {
  return (
    <pre
      tabIndex={0}
      onKeyDown={(event) => {
        const node = event.currentTarget;
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          node.scrollWidth <= node.clientWidth
        )
          return;
        const maximum = node.scrollWidth - node.clientWidth;
        const positions: Record<string, number> = {
          ArrowRight: Math.min(maximum, node.scrollLeft + 40),
          ArrowLeft: Math.max(0, node.scrollLeft - 40),
          Home: 0,
          End: maximum,
        };
        const position = positions[event.key];
        if (position === undefined) return;
        event.preventDefault();
        node.scrollLeft = position;
      }}
    >
      {children}
    </pre>
  );
}
