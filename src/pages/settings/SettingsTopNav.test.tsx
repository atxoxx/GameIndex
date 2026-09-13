import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsTopNav from "./SettingsTopNav";
import { getCategoryForTab } from "./settingsCatalog";
import type { SettingsNavGroup, SettingsSearchEntry } from "./types";

vi.mock("../../context/UpdateContext", () => ({
  useUpdate: () => ({ status: "idle" }),
}));

const mockGroups: SettingsNavGroup[] = [
  {
    id: "personalize",
    label: "Personalize",
    items: [
      { tab: "general", label: "General", icon: <span>G</span> },
      { tab: "appearance", label: "Appearance", icon: <span>A</span> },
    ],
  },
  {
    id: "connections",
    label: "Connections",
    items: [
      { tab: "integrations", label: "Integrations", icon: <span>I</span> },
      { tab: "discord", label: "Discord", icon: <span>D</span> },
    ],
  },
  {
    id: "downloads",
    label: "Downloads",
    items: [
      { tab: "downloads", label: "Downloads", icon: <span>DL</span> },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { tab: "launcher", label: "Launcher", icon: <span>L</span> },
      { tab: "privacy", label: "Privacy", icon: <span>P</span> },
    ],
  },
];

const mockSearchIndex: SettingsSearchEntry[] = [
  { id: "general", tab: "general", kind: "tab", label: "General", crumb: "Personalize", keywords: "lang" },
  { id: "appearance", tab: "appearance", kind: "tab", label: "Appearance", crumb: "Personalize", keywords: "theme" },
];

describe("getCategoryForTab", () => {
  it("maps personalize tabs to personalize category", () => {
    expect(getCategoryForTab("general")).toBe("personalize");
    expect(getCategoryForTab("appearance")).toBe("personalize");
    expect(getCategoryForTab("interface")).toBe("personalize");
    expect(getCategoryForTab("hardware")).toBe("personalize");
  });

  it("maps connections tabs to connections category", () => {
    expect(getCategoryForTab("integrations")).toBe("connections");
    expect(getCategoryForTab("discord")).toBe("connections");
  });

  it("maps downloads tabs to downloads category", () => {
    expect(getCategoryForTab("downloads")).toBe("downloads");
    expect(getCategoryForTab("plugins")).toBe("downloads");
  });

  it("maps system tabs to system category", () => {
    expect(getCategoryForTab("launcher")).toBe("system");
    expect(getCategoryForTab("compatibility")).toBe("system");
    expect(getCategoryForTab("privacy")).toBe("system");
    expect(getCategoryForTab("backup")).toBe("system");
  });
});

describe("SettingsTopNav component", () => {
  it("renders all category tabs and active category subtabs", () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={["/settings/general"]}>
        <SettingsTopNav
          groups={mockGroups}
          activeTab="general"
          searchIndex={mockSearchIndex}
          connectedIntegrations={2}
          showSubtabs={true}
          onToggleSubtabs={onToggle}
          t={(k) => k}
        />
      </MemoryRouter>,
    );

    // Categories are rendered
    expect(screen.getByText("Personalize")).toBeDefined();
    expect(screen.getByText("Connections")).toBeDefined();
    expect(screen.getByText("Downloads")).toBeDefined();
    expect(screen.getByText("System")).toBeDefined();

    // Active category (Personalize) subtabs are rendered
    expect(screen.getByText("General")).toBeDefined();
    expect(screen.getByText("Appearance")).toBeDefined();

    // Subtabs of other categories are not rendered in subtabs bar
    expect(screen.queryByText("Discord")).toBeNull();
  });

  it("fires onToggleSubtabs when toggle button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={["/settings/general"]}>
        <SettingsTopNav
          groups={mockGroups}
          activeTab="general"
          searchIndex={mockSearchIndex}
          connectedIntegrations={0}
          showSubtabs={true}
          onToggleSubtabs={onToggle}
          t={(k) => k}
        />
      </MemoryRouter>,
    );

    const toggleBtn = screen.getByRole("button", { pressed: true });
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders dynamic subtabs when active tab belongs to connections", () => {
    render(
      <MemoryRouter initialEntries={["/settings/integrations"]}>
        <SettingsTopNav
          groups={mockGroups}
          activeTab="integrations"
          searchIndex={mockSearchIndex}
          connectedIntegrations={3}
          showSubtabs={true}
          onToggleSubtabs={vi.fn()}
          t={(k) => k}
        />
      </MemoryRouter>,
    );

    // Integrations and Discord are shown
    expect(screen.getByText("Integrations")).toBeDefined();
    expect(screen.getByText("Discord")).toBeDefined();

    // Personalize subtabs are not in subtabs bar
    expect(screen.queryByText("Appearance")).toBeNull();
  });
});
