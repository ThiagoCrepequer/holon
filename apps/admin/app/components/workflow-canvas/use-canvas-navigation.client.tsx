import * as React from "react";

/** Native scrolling keeps every scaled edge reachable, including by keyboard/touch. */
export function useCanvasNavigation(
  width: number,
  height: number,
  visible: boolean,
) {
  const area = React.useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = React.useState(1);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = React.useRef(false);
  const pending = React.useRef<{ left: number; top: number } | null>(null);

  React.useLayoutEffect(() => {
    const element = area.current;
    if (!element) return undefined;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  React.useLayoutEffect(() => {
    if (pending.current && area.current) {
      area.current.scrollLeft = pending.current.left;
      area.current.scrollTop = pending.current.top;
      pending.current = null;
    }
  }, [zoom]);

  const changeZoom = (requested: number, center = false) => {
    const element = area.current;
    if (!element) return;
    const next = Math.min(
      2,
      Math.max(center ? Number.EPSILON : 0.05, requested),
    );
    const oldOffset = Math.max(0, (element.clientWidth - width * zoom) / 2);
    const newOffset = Math.max(0, (element.clientWidth - width * next) / 2);
    const position = {
      left: center
        ? Math.max(0, (width * next - element.clientWidth) / 2)
        : ((element.scrollLeft + element.clientWidth / 2 - oldOffset) / zoom) *
            next +
          newOffset -
          element.clientWidth / 2,
      top: center
        ? 0
        : ((element.scrollTop + element.clientHeight / 2) / zoom) * next -
          element.clientHeight / 2,
    };
    if (next === zoom) {
      element.scrollLeft = position.left;
      element.scrollTop = position.top;
    } else {
      pending.current = position;
      setZoom(next);
    }
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return {
    area,
    zoom,
    dragging,
    scaledWidth: Math.max(size.width, width * zoom),
    scaledHeight: Math.max(size.height, height * zoom),
    offsetX: Math.max(0, (size.width - width * zoom) / 2),
    zoomBy: (delta: number) => changeZoom(Number((zoom + delta).toFixed(2))),
    reset: () => changeZoom(1, true),
    fit: () => {
      const element = area.current;
      if (element && element.clientWidth && element.clientHeight)
        changeZoom(
          Math.min(
            1,
            element.clientWidth / width,
            element.clientHeight / height,
          ),
          true,
        );
    },
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        // Touch uses the browser's native pan/inertia and pinch accessibility zoom.
        if (event.pointerType === "touch" || event.button !== 0) return;
        suppressClick.current = false;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop,
          moved: false,
        };
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        if (!(event.buttons & 1)) {
          finishDrag(event);
          return;
        }
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 5) return;
        start.moved = true;
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.scrollLeft = start.left - dx;
        event.currentTarget.scrollTop = start.top - dy;
        event.preventDefault();
      },
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onLostPointerCapture: finishDrag,
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      },
    },
  };
}
