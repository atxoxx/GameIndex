import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WebLinksSourceMenu from "./WebLinksSourceMenu";
import { FIXED_SOURCES, MY_LINKS_KEY } from "./sources";
import type { SourceDef } from "./types";

const LABELS: Record<string, string> = {
  "weblinks.categories.all": "All Sources",
  "weblinks.categories.stores": "Stores & Deals",
  "weblinks.categories.wikis": "Wikis & Guides",
  "weblinks.categories.community": "Community & Media",
  "weblinks.categories.modding": "Modding & Tools",
  "weblinks.categories.mylinks": "My Links",
  "weblinks.hub.manage": "Manage links",
  "weblinks.hub.noResults": "No links match that search.",
  "weblinks.hub.searchPlaceholder": "Search links and sources…",
  "weblinks.menu.browseAll": "Browse all links",
  "weblinks.menu.switchSource": "Switch source",
  "weblinks.myLinks": "My Links",
};

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => LABELS[key] ?? key }),
}));

const CUSTOM_LINK: SourceDef = {
  key: "https://example.com/wiki",
  label: "Example Wiki",
  category: "mylinks",
  accent: "var(--color-accent)",
  iconBg: "var(--color-bg-tertiary)",
  icon: null,
  url: "https://example.com/wiki",
};

const SOURCES = [...FIXED_SOURCES, CUSTOM_LINK];

function renderMenu(activeSourceKey = "steam") {
  const onSelectSource = vi.fn();
  const onOpenHub = vi.fn();
  const onMenuOpenChange = vi.fn();
  const utils = render(
    <WebLinksSourceMenu
      sources={SOURCES}
      activeSourceKey={activeSourceKey}
      activeSourceDef={
        SOURCES.find((source) => source.key === activeSourceKey) ??
        FIXED_SOURCES[0]
      }
      onSelectSource={onSelectSource}
      onOpenHub={onOpenHub}
      onMenuOpenChange={onMenuOpenChange}
    />,
  );
  const trigger = utils.container.querySelector(
    ".wl-source-menu-trigger",
  ) as HTMLButtonElement;
  return { ...utils, trigger, onSelectSource, onOpenHub, onMenuOpenChange };
}

function openMenu() {
  const handle = renderMenu();
  fireEvent.click(handle.trigger);
  return handle;
}

describe("WebLinksSourceMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens on the trigger and shows one header per category", () => {
    const { trigger, onMenuOpenChange } = renderMenu();

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(onMenuOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    for (const header of [
      "Stores & Deals",
      "Wikis & Guides",
      "Community & Media",
      "Modding & Tools",
      "My Links",
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it("selects a source and closes the menu", () => {
    const { onSelectSource, onMenuOpenChange } = openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "SteamDB" }));

    expect(onSelectSource).toHaveBeenCalledWith("steamdb");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onMenuOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("marks the active source as checked", () => {
    const { trigger } = renderMenu("protondb");
    fireEvent.click(trigger);

    expect(
      screen.getByRole("menuitemradio", { name: "ProtonDB" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "Steam" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("filters every group by the search query and keeps the headers", () => {
    openMenu();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "steam" },
    });

    expect(screen.getByText("Stores & Deals")).toBeInTheDocument();
    expect(screen.getByText("Modding & Tools")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Steam" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: "SteamGridDB" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wikis & Guides")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: "GOG" })).not.toBeInTheDocument();
  });

  it("selects a custom link from the My links section", () => {
    const { onSelectSource } = openMenu();

    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Example Wiki" }),
    );
    expect(onSelectSource).toHaveBeenCalledWith(CUSTOM_LINK.url);
  });

  it("routes the manage entry through the my-links key", () => {
    const { onSelectSource } = openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Manage links" }));

    expect(onSelectSource).toHaveBeenCalledWith(MY_LINKS_KEY);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the hub from the footer entry", () => {
    const { onOpenHub } = openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Browse all links/ }));

    expect(onOpenHub).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { trigger } = openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click", () => {
    const { onSelectSource } = openMenu();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onSelectSource).not.toHaveBeenCalled();
  });

  it("moves focus between items with the arrow keys", () => {
    openMenu();

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    expect(document.activeElement).toHaveAccessibleName("Steam");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAccessibleName("SteamDB");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toHaveAccessibleName("Steam");
  });
});
