import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useOrderDrag } from "./useOrderDrag";

type DragApi = ReturnType<typeof useOrderDrag>;

let api: DragApi | null = null;
// jsdom has no hit-testing, so `elementFromPoint` is installed as a mock and
// each test aims it at a rendered row.
let elementFromPoint: Mock;

function Harness({ onReorder }: { onReorder: (from: number, to: number) => void }) {
  const drag = useOrderDrag(onReorder);
  api = drag;
  return (
    <div ref={drag.containerRef}>
      {[0, 1, 2].map((i) => (
        <div key={i} data-order-index={i} data-testid={`row-${i}`} />
      ))}
    </div>
  );
}

function movePointer(x: number, y: number) {
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
}

function releasePointer() {
  window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
}

function pointAtRow(index: number) {
  elementFromPoint.mockReturnValue(screen.getByTestId(`row-${index}`));
}

beforeEach(() => {
  elementFromPoint = vi.fn(() => null);
  Object.defineProperty(document, "elementFromPoint", {
    value: elementFromPoint,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  api = null;
});

describe("useOrderDrag", () => {
  it("commits the move when the pointer is released over another row", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    pointAtRow(2);

    act(() => api!.startDrag(0, { x: 0, y: 0 }));
    act(() => {
      movePointer(120, 8);
      releasePointer();
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it("does nothing on a plain press and release", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    pointAtRow(0);

    act(() => api!.startDrag(0, { x: 0, y: 0 }));
    act(() => {
      movePointer(2, 1);
      releasePointer();
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(api!.movedRef.current).toBe(false);
  });

  it("flags a move once the pointer travels past the drag threshold", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    act(() => api!.startDrag(0, { x: 0, y: 0 }));
    act(() => movePointer(20, 0));

    expect(api!.movedRef.current).toBe(true);
    act(() => releasePointer());
  });

  it("still reorders when no start point was supplied", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    pointAtRow(1);

    act(() => api!.startDrag(0));
    act(() => {
      movePointer(10, 8);
      releasePointer();
    });

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it("ignores rows outside the container", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const stray = document.createElement("div");
    stray.setAttribute("data-order-index", "9");
    elementFromPoint.mockReturnValue(stray);

    act(() => api!.startDrag(0, { x: 0, y: 0 }));
    act(() => {
      movePointer(120, 8);
      releasePointer();
    });

    expect(onReorder).not.toHaveBeenCalled();
  });
});
