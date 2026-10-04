import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import BigScreenDashboardBackdrop from "./BigScreenDashboardBackdrop";

afterEach(() => {
  document.documentElement.removeAttribute("data-platform");
});

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

  it("collapses to a single static layer on linux", () => {
    document.documentElement.dataset.platform = "linux";
    const { container, rerender } = render(
      <BigScreenDashboardBackdrop
        staticUrl="https://cdn/one.jpg"
        animatedUrl="https://cdn/one.webp"
        artKey="1"
      />,
    );
    expect(container.querySelectorAll(".bigscreen-dashboard-backdrop-layer")).toHaveLength(1);
    expect(container.querySelector(".bigscreen-dashboard-backdrop-animated")).toBeNull();

    rerender(
      <BigScreenDashboardBackdrop
        staticUrl="https://cdn/two.jpg"
        animatedUrl="https://cdn/two.webp"
        artKey="2"
      />,
    );
    expect(container.querySelectorAll(".bigscreen-dashboard-backdrop-layer")).toHaveLength(1);
  });
});
