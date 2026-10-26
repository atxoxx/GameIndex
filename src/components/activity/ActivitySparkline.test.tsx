import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivitySparkline } from "./ActivitySparkline";

const flat = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 0 }));
const live = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 68 + i }));

function sparkline(data: { x: number; y: number }[]) {
  return (
    <ActivitySparkline
      data={data}
      label=""
      unit="°C"
      value={data[0]?.y ?? 0}
      max={data[data.length - 1]?.y ?? 0}
      min={data[0]?.y ?? 0}
      thresholds={{ warn: 75, danger: 85 }}
      emptyLabel="No temperature data"
    />
  );
}

describe("ActivitySparkline", () => {
  it("keeps a stable hook count when a series flips between empty and live", () => {
    const { rerender } = render(sparkline(flat));
    expect(screen.getByText("No temperature data")).toBeTruthy();

    // Switching the time range re-renders the same instance; an early return
    // that skips a hook must not change the hook count between renders.
    expect(() => rerender(sparkline(live))).not.toThrow();
    expect(screen.queryByText("No temperature data")).toBeNull();

    expect(() => rerender(sparkline(flat))).not.toThrow();
    expect(screen.getByText("No temperature data")).toBeTruthy();
  });

  it("shows the readouts when the series has data", () => {
    render(sparkline(live));
    expect(screen.queryByText("No temperature data")).toBeNull();
    expect(screen.getByText("79°C")).toBeTruthy();
  });
});
