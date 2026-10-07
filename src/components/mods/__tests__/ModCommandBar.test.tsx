import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ModCommandBar from "../ModCommandBar";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

function makeProps(overrides: Partial<React.ComponentProps<typeof ModCommandBar>> = {}) {
  return {
    search: "",
    onSearchChange: vi.fn(),
    filterTab: "all" as const,
    onFilterTabChange: vi.fn(),
    modSort: "order" as const,
    onSortChange: vi.fn(),
    selectedEngine: null,
    onEngineChange: vi.fn(),
    availableEngines: ["bethesda", "bepinex"],
    counts: { total: 10, enabled: 7, disabled: 3, updates: 2, conflicts: 1 },
    canScan: true,
    scanning: false,
    checkingUpdates: false,
    onScan: vi.fn(),
    onCancelScan: vi.fn(),
    onInstallMod: vi.fn(),
    onCheckUpdates: vi.fn(),
    onOpenPresets: vi.fn(),
    onOpenExport: vi.fn(),
    onPickFolder: vi.fn(),
    hasModsRoot: true,
    nexusOpen: false,
    onToggleNexus: vi.fn(),
    onUndo: vi.fn(),
    ...overrides,
  };
}

describe("ModCommandBar", () => {
  afterEach(cleanup);

  it("renders a status filter per bucket with its count", () => {
    render(<ModCommandBar {...makeProps()} />);

    expect(screen.getByRole("tab", { name: /mods\.filter\.all/ })).toHaveTextContent("10");
    expect(screen.getByRole("tab", { name: /mods\.filter\.enabled/ })).toHaveTextContent("7");
    expect(screen.getByRole("tab", { name: /mods\.filter\.disabled/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /mods\.filter\.updates/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /mods\.filter\.conflicts/ })).toHaveTextContent("1");
  });

  it("reports the chosen status filter", () => {
    const onFilterTabChange = vi.fn();
    render(<ModCommandBar {...makeProps({ onFilterTabChange })} />);

    fireEvent.click(screen.getByRole("tab", { name: /mods\.filter\.updates/ }));

    expect(onFilterTabChange).toHaveBeenCalledWith("updates");
  });

  it("hides the conflicts tab when there are none", () => {
    render(
      <ModCommandBar
        {...makeProps({
          counts: { total: 10, enabled: 7, disabled: 3, updates: 0, conflicts: 0 },
        })}
      />,
    );

    expect(screen.queryByRole("tab", { name: /mods\.filter\.conflicts/ })).toBeNull();
  });

  it("disables scan when the game has no local path", () => {
    render(<ModCommandBar {...makeProps({ canScan: false })} />);

    expect(screen.getByRole("button", { name: /mods\.rescan/ })).toBeDisabled();
  });

  it("opens the filters popover with sort and engine controls", () => {
    render(<ModCommandBar {...makeProps()} />);

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /mods\.filters/ }));

    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("exposes secondary actions in the overflow menu", () => {
    const onCheckUpdates = vi.fn();
    render(<ModCommandBar {...makeProps({ onCheckUpdates })} />);

    fireEvent.click(screen.getByRole("button", { name: "mods.moreActions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /mods\.checkUpdates/ }));

    expect(onCheckUpdates).toHaveBeenCalledTimes(1);
  });
});
