import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  close: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: { current?: number; total?: number }) =>
      key === "setup.wizard.step"
        ? `${vars?.current ?? 0} of ${vars?.total ?? 0}`
        : key,
  }),
}));

vi.mock("../../context/SetupWizardContext", () => ({
  useSetupWizard: () => ({
    isOpen: true,
    closeWizard: h.close,
    finishWizard: h.finish,
  }),
}));

vi.mock("../../hooks/GamepadProvider", () => ({
  GamepadProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./setupSteps", () => {
  const Icon = () => null;
  return {
    SETUP_STEPS: [
      { id: "one", titleKey: "step.one.title", descKey: "step.one.desc", icon: Icon, Component: () => null },
      { id: "two", titleKey: "step.two.title", descKey: "step.two.desc", icon: Icon, Component: () => null },
      { id: "three", titleKey: "step.three.title", descKey: "step.three.desc", icon: Icon, Component: () => null },
    ],
  };
});

import SetupWizard from "./SetupWizard";

describe("SetupWizard", () => {
  beforeEach(() => {
    h.close.mockReset();
    h.finish.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("walks forward and back through the steps (happy path)", () => {
    render(<SetupWizard />);

    expect(
      screen.getByRole("heading", { name: "step.one.title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /setup.wizard.back/ }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /setup.wizard.next/ }));
    expect(
      screen.getByRole("heading", { name: "step.two.title" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /setup.wizard.back/ }));
    expect(
      screen.getByRole("heading", { name: "step.one.title" }),
    ).toBeInTheDocument();
  });

  it("finishes from the last step with the single primary action", () => {
    render(<SetupWizard />);

    fireEvent.click(screen.getByRole("button", { name: /setup.wizard.next/ }));
    fireEvent.click(screen.getByRole("button", { name: /setup.wizard.next/ }));

    expect(
      screen.getByRole("button", { name: /setup.wizard.open/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /setup.wizard.skip/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /setup.wizard.open/ }));
    expect(h.finish).toHaveBeenCalledTimes(1);
  });

  it("skips and closes on Escape (alternate paths)", () => {
    render(<SetupWizard />);

    fireEvent.click(screen.getByRole("button", { name: /setup.wizard.skip/ }));
    expect(h.close).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.close).toHaveBeenCalledTimes(2);
  });
});
