import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import BigScreenDashboardBackdrop from "./BigScreenDashboardBackdrop";

describe("BigScreenDashboardBackdrop", () => {
  it("renders nothing when there is no static art", () => {
    const { container } = render(<BigScreenDashboardBackdrop staticUrl={null} />);
    expect(container.querySelector(".bigscreen-dashboard-backdrop-container")).toBeNull();
  });

  it("renders the static image and overlay", () => {
    const { container } = render(
      <BigScreenDashboardBackdrop staticUrl="https://cdn/banner.jpg" artKey="1" />,
    );
    const img = container.querySelector<HTMLImageElement>(
      ".bigscreen-dashboard-backdrop-img",
    );
    expect(img?.src).toBe("https://cdn/banner.jpg");
    expect(container.querySelector(".bigscreen-dashboard-backdrop-overlay")).not.toBeNull();
  });

  it("layers the animated art when available", () => {
    const { container } = render(
      <BigScreenDashboardBackdrop
        staticUrl="https://cdn/banner.jpg"
        animatedUrl="https://cdn/banner.webp"
        artKey="1"
      />,
    );
    const animated = container.querySelector<HTMLImageElement>(
      ".bigscreen-dashboard-backdrop-animated",
    );
    expect(animated?.src).toBe("https://cdn/banner.webp");
    expect(animated?.classList.contains("is-loaded")).toBe(false);
  });
});
