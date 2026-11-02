import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import StoreAvailabilityFilter from "./StoreAvailabilityFilter";
import type { StoreAvailabilityFilterProps } from "./StoreAvailabilityFilter";
import type { PluginInfo } from "../../types/plugins";
import type { SourceLink } from "../../types/source";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function plugin(
  id: string,
  name: string,
  platformCategory = "pc"
): PluginInfo {
  return {
    id,
    name,
    version: "1.0.0",
    author: "tester",
    description: "",
    sourceUrl: "",
    fileHash: "",
    filePath: "",
    enabled: true,
    importedAt: 0,
    lastError: null,
    platformCategory,
  } as PluginInfo;
}

function source(id: string, name: string): SourceLink {
  return {
    id,
    url: "",
    name,
    enabled: true,
    lastFetched: null,
    gameCount: 0,
  };
}

function props(
  overrides: Partial<StoreAvailabilityFilterProps> = {}
): StoreAvailabilityFilterProps {
  return {
    sources: [],
    selectedSourceIds: [],
    sourceCounts: {},
    sourceMatchMode: "all",
    onSourcesChange: vi.fn(),
    onSourceMatchModeChange: vi.fn(),
    plugins: [],
    selectedPluginIds: [],
    pluginCounts: {},
    pluginErrors: {},
    pluginMatchMode: "all",
    onPluginsChange: vi.fn(),
    onPluginMatchModeChange: vi.fn(),
    checking: false,
    uncheckedPlugins: 0,
    probeError: null,
    ...overrides,
  };
}

function openPlugins(view: ReturnType<typeof render>) {
  fireEvent.click(
    view.getByRole("button", { name: "store.filter.plugins" })
  );
}

describe("StoreAvailabilityFilter", () => {
  it("selects a plugin through its dropdown", () => {
    const p = props({
      plugins: [plugin("p1", "Alpha"), plugin("p2", "Beta", "console")],
      pluginCounts: { p1: { checked: 4, available: 2 } },
    });
    const view = render(<StoreAvailabilityFilter {...p} />);
    const { getByText } = view;

    openPlugins(view);
    expect(getByText("settings.plugins.categoryPc")).toBeInTheDocument();
    expect(getByText("settings.plugins.categoryConsole")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();

    fireEvent.click(getByText("Alpha"));
    expect(p.onPluginsChange).toHaveBeenCalledWith(["p1"]);
  });

  it("selects a download source through its dropdown", () => {
    const p = props({
      sources: [source("s1", "FitGirl"), source("s2", "DODI")],
      selectedSourceIds: [],
    });
    const { getByRole, getByText } = render(<StoreAvailabilityFilter {...p} />);

    fireEvent.click(
      getByRole("button", { name: "store.filter.downloadSources" })
    );
    fireEvent.click(getByText("DODI"));
    expect(p.onSourcesChange).toHaveBeenCalledWith(["s2"]);
  });

  it("marks plugins that could not be checked", () => {
    const p = props({
      plugins: [plugin("p1", "Alpha")],
      pluginErrors: { p1: "missing API key" },
      uncheckedPlugins: 1,
    });
    const view = render(<StoreAvailabilityFilter {...p} />);

    openPlugins(view);
    expect(
      view.getByRole("img", { name: "store.filter.pluginCheckFailed" })
    ).toBeInTheDocument();
  });

  it("discloses unchecked plugins when the filter is in use", () => {
    const p = props({
      plugins: [plugin("p1", "Alpha")],
      selectedPluginIds: ["p1"],
      uncheckedPlugins: 1,
    });
    const { getByText } = render(<StoreAvailabilityFilter {...p} />);

    expect(getByText(/store\.filter\.pluginCaveat/)).toBeInTheDocument();
    expect(getByText(/store\.filter\.uncheckedPlugins/)).toBeInTheDocument();
  });

  it("points at Settings when no plugin is installed", () => {
    const { getByText } = render(<StoreAvailabilityFilter {...props()} />);
    expect(getByText("store.filter.noPlugins")).toBeInTheDocument();
  });

  it("offers the any/all toggle only once two plugins are selected", () => {
    const p = props({
      plugins: [plugin("p1", "Alpha"), plugin("p2", "Beta")],
      selectedPluginIds: ["p1"],
    });
    const { queryByText, rerender } = render(<StoreAvailabilityFilter {...p} />);
    expect(queryByText("store.filter.matchAll")).toBeNull();

    rerender(
      <StoreAvailabilityFilter
        {...p}
        selectedPluginIds={["p1", "p2"]}
        pluginMatchMode="any"
      />
    );
    fireEvent.click(queryByText("store.filter.matchAll") as HTMLElement);
    expect(p.onPluginMatchModeChange).toHaveBeenCalledWith("all");
  });
});
