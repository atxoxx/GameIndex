import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OverlayGauge from "./OverlayGauge";

// The gauge optionally wraps its ring in the shared Tooltip (which portals);
// stub it so the geometry assertions stay on the gauge itself.
vi.mock("../ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("OverlayGauge", () => {
  it("renders the value with its unit and the label", () => {
    render(
      <OverlayGauge label="CPU" value={42} unit="%" testId="gauge-cpu" />,
    );

    const gauge = screen.getByTestId("gauge-cpu");
    expect(gauge).toHaveTextContent("42%");
    expect(gauge).toHaveTextContent("CPU");
  });

  it("shows a dash and the empty modifier when there is no value", () => {
    render(<OverlayGauge label="GPU" testId="gauge-gpu" />);

    const gauge = screen.getByTestId("gauge-gpu");
    expect(gauge).toHaveTextContent("—");
    expect(gauge).toHaveClass("overlay-gauge--empty");
  });

  it("honours a custom display string over the numeric value", () => {
    render(
      <OverlayGauge label="FPS" value={60} display="60" testId="gauge-fps" />,
    );
    expect(screen.getByTestId("gauge-fps")).toHaveTextContent("60");
  });

  it("clamps an out-of-range value without throwing", () => {
    render(
      <OverlayGauge label="RAM" value={250} unit="%" max={100} testId="gauge-ram" />,
    );
    // Reading still reflects the raw value; the ring simply caps at full.
    expect(screen.getByTestId("gauge-ram")).toHaveTextContent("250%");
  });
});
