import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PageWidgetKey } from "../../context/interfaceLayout";
import DetailRail from "./DetailRail";
import type { DetailRailGroupDef } from "./detailRailGroups";

/**
 * The rail takes its visibility/order from the Layout Studio; these tests pin
 * the part the rail owns: grouping, panel ordering, collapse persistence and
 * the empty-panel guard.
 */
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const settings = vi.hoisted(() => ({ simple: false }));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ isSimpleUi: settings.simple }),
  useWidgetVisible: () => true,
  usePageWidgetOrder: () => undefined,
  usePageWidgetLayout: () => ({
    isVisible: () => true,
    orderOf: (widget: PageWidgetKey) =>
      [
        "gamePulse",
        "gameSaveBackup",
        "gameInfoKpi",
        "gameDlcCard",
        "gameValue",
        "gameRatings",
        "gameSpecsCard",
        "gameReleases",
      ].indexOf(widget),
  }),
}));

const groups: DetailRailGroupDef[] = [
  {
    id: "play",
    labelKey: "rail.play",
    icon: () => null,
    widgets: ["gamePulse", "gameSaveBackup"],
    defaultOpen: true,
  },
  {
    id: "facts",
    labelKey: "rail.facts",
    icon: () => null,
    widgets: ["gameInfoKpi", "gameValue"],
    defaultOpen: false,
  },
  {
    id: "reference",
    labelKey: "rail.reference",
    icon: () => null,
    widgets: ["gameSpecsCard"],
    defaultOpen: true,
  },
];

function renderRail(
  renderWidget: (widget: PageWidgetKey) => ReactNode = (widget) => (
    <div data-testid={`card-${widget}`} />
  ),
) {
  return render(
    <DetailRail page="game" groups={groups} renderWidget={renderWidget} />,
  );
}

describe("DetailRail", () => {
  beforeEach(() => {
    settings.simple = false;
    localStorage.clear();
  });

  it("groups cards into collapsible panels", () => {
    renderRail();

    expect(screen.getByRole("button", { name: "rail.play" })).toBeTruthy();
    expect(screen.getByTestId("card-gamePulse")).toBeTruthy();
    expect(screen.getByTestId("card-gameSaveBackup")).toBeTruthy();

    // The second panel ships collapsed, with its cards unmounted.
    const facts = screen.getByRole("button", { name: "rail.facts" });
    expect(facts.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("card-gameInfoKpi")).toBeNull();

    fireEvent.click(facts);
    expect(facts.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("card-gameInfoKpi")).toBeTruthy();
    expect(localStorage.getItem("gamelib.detail_rail.game.facts")).toBe("open");
  });

  it("drops panels whose cards render nothing", () => {
    const { container } = renderRail(() => null);
    expect(container.querySelector(".rail-group")).toBeNull();
  });

  it("leaves complete-only cards out of Simple UI mode", () => {
    settings.simple = true;
    renderRail();

    expect(screen.queryByRole("button", { name: "rail.reference" })).toBeNull();
    expect(screen.queryByTestId("card-gameSpecsCard")).toBeNull();
    // Panels whose cards survive Simple mode are still there.
    expect(screen.getByTestId("card-gamePulse")).toBeTruthy();
  });
});
