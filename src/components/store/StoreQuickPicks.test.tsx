import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import type { StoreGameSummary } from "../../types/game";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("./StoreQuickPickCard", () => ({
  default: ({ game }: { game: StoreGameSummary }) => (
    <div data-testid="quick-pick-card">{game.name}</div>
  ),
}));

const games = [
  { id: 1, slug: "hades", name: "Hades" },
  { id: 2, slug: "celeste", name: "Celeste" },
] as unknown as StoreGameSummary[];

async function loadComponent(): Promise<ComponentType<Record<string, unknown>>> {
  const mod = await import("./StoreQuickPicks");
  return mod.default as unknown as ComponentType<Record<string, unknown>>;
}

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
});

afterEach(cleanup);

describe("StoreQuickPicks", () => {
  it("renders the spotlight picks returned by the backend", async () => {
    invokeMock.mockResolvedValue(games);
    const StoreQuickPicks = await loadComponent();

    const { findAllByTestId, findByText } = render(
      <StoreQuickPicks onPickGame={() => {}} onDismiss={() => {}} />
    );

    expect(await findByText("store.quickPicks.title")).toBeInTheDocument();
    expect(await findAllByTestId("quick-pick-card")).toHaveLength(2);
  });

  it("renders nothing when the spotlight request fails", async () => {
    invokeMock.mockRejectedValue(new Error("offline"));
    const StoreQuickPicks = await loadComponent();

    const { container, queryByText } = render(
      <StoreQuickPicks onPickGame={() => {}} onDismiss={() => {}} />
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    expect(queryByText("store.quickPicks.title")).toBeNull();
    expect(container.querySelector(".store-quick-picks")).toBeNull();
  });
});
