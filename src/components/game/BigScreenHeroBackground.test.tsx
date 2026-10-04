import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import BigScreenHeroBackground from "./BigScreenHeroBackground";

afterEach(() => {
  document.documentElement.removeAttribute("data-platform");
});

describe("BigScreenHeroBackground", () => {
  it("renders a single static slide and no backdrop video on linux", () => {
    document.documentElement.dataset.platform = "linux";
    const { container } = render(
      <BigScreenHeroBackground
        screenshots={["https://cdn/a.jpg", "https://cdn/b.jpg"]}
        videos={["https://cdn/trailer.mp4"]}
      />,
    );
    expect(container.querySelectorAll(".bigscreen-gamepage-hero-bg-slide")).toHaveLength(1);
    expect(container.querySelector(".bigscreen-gamepage-hero-bg-video")).toBeNull();
  });

  it("keeps the two-slide cross-fade cycle off linux", () => {
    const { container } = render(
      <BigScreenHeroBackground screenshots={["https://cdn/a.jpg", "https://cdn/b.jpg"]} />,
    );
    expect(container.querySelectorAll(".bigscreen-gamepage-hero-bg-slide")).toHaveLength(2);
  });

  it("renders the video backdrop off linux", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const { container } = render(
      <BigScreenHeroBackground videos={["https://cdn/trailer.mp4"]} />,
    );
    expect(container.querySelector(".bigscreen-gamepage-hero-bg-video")).not.toBeNull();
    play.mockRestore();
  });
});
