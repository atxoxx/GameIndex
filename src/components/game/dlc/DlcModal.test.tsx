import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DlcModal from "./DlcModal";
import type { SteamDlcItem } from "../../../types/steam";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

function makeDlc(overrides: Partial<SteamDlcItem> = {}): SteamDlcItem {
  return {
    appId: 12345,
    name: "Enshrouded: Prologue",
    headerImage: "https://example.test/header.jpg",
    priceFormatted: "9,99€",
    initialPriceFormatted: "19,99€",
    discountPercent: 50,
    finalPriceCents: 999,
    initialPriceCents: 1999,
    isFree: false,
    releaseDate: "24 Jan, 2024",
    shortDescription: "A short prequel.<br />Play it first.",
    isOwned: false,
    isInstalled: false,
    isWatched: false,
    ...overrides,
  };
}

describe("DlcModal", () => {
  it("shows the add-on art, status, price and actions", () => {
    const onToggleOwned = vi.fn();
    const onToggleWatch = vi.fn();
    const onOpenStore = vi.fn();

    render(
      <DlcModal
        dlc={makeDlc()}
        onClose={vi.fn()}
        onToggleOwned={onToggleOwned}
        onToggleWatch={onToggleWatch}
        onOpenStore={onOpenStore}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Enshrouded: Prologue" }),
    ).toBeTruthy();
    expect(screen.getByText(/dlc\.releasedOn.*24 Jan, 2024/)).toBeTruthy();
    expect(screen.getByText("dlc.unowned")).toBeTruthy();
    expect(screen.getByText("dlc.notInstalled")).toBeTruthy();
    expect(screen.getByText("9,99€")).toBeTruthy();
    expect(screen.getByText("19,99€")).toBeTruthy();
    expect(screen.getByText("−50%")).toBeTruthy();
    expect(screen.getByText(/A short prequel\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "dlc.markOwned" }));
    expect(onToggleOwned).toHaveBeenCalledWith(expect.objectContaining({ appId: 12345 }));

    fireEvent.click(screen.getByRole("button", { name: "dlc.watch" }));
    expect(onToggleWatch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "dlc.openInStore" }));
    expect(onOpenStore).toHaveBeenCalledTimes(1);
  });

  it("falls back to placeholder copy and closes on Escape or backdrop", () => {
    const onClose = vi.fn();
    render(
      <DlcModal
        dlc={makeDlc({
          headerImage: undefined,
          shortDescription: undefined,
          priceFormatted: undefined,
        })}
        onClose={onClose}
        onToggleOwned={vi.fn()}
        onToggleWatch={vi.fn()}
        onOpenStore={vi.fn()}
      />,
    );

    expect(document.querySelector(".dlc-modal__hero.is-empty")).toBeTruthy();
    expect(document.querySelector(".dlc-modal__hero img")).toBeNull();
    expect(screen.getByText("dlc.noCatalogDescription")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(document.querySelector(".modal-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
