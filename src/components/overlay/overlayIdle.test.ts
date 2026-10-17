import { describe, expect, it } from "vitest";
import { idleAction } from "./overlayIdle";

describe("idleAction", () => {
  it("does nothing while both timers are off", () => {
    expect(idleAction(0)).toBe("none");
    expect(idleAction(5, 0, 0)).toBe("none");
    expect(idleAction(999, undefined, undefined)).toBe("none");
  });

  it("dims once the dim threshold passes", () => {
    expect(idleAction(29, 30)).toBe("none");
    expect(idleAction(30, 30)).toBe("dim");
    expect(idleAction(120, 30)).toBe("dim");
  });

  it("hides once the hide threshold passes", () => {
    expect(idleAction(59, 0, 60)).toBe("none");
    expect(idleAction(60, 0, 60)).toBe("hide");
  });

  it("hide wins once both thresholds have passed", () => {
    expect(idleAction(45, 30, 60)).toBe("dim");
    expect(idleAction(60, 30, 60)).toBe("hide");
  });

  it("keeps a timer off while its threshold is 0", () => {
    expect(idleAction(500, 0, 30)).toBe("hide");
    expect(idleAction(500, 30, 0)).toBe("dim");
  });

  it("ignores negative thresholds", () => {
    expect(idleAction(10, -5, -5)).toBe("none");
  });
});
