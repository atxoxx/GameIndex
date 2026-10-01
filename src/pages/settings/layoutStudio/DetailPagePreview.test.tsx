import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailPagePreview } from "./DetailPagePreview";
import { WIDGET_ICON } from "./widgetIcons";
import { interfacePageDef } from "../../../context/interfaceLayout";
import type { OrderListItem } from "./types";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));

vi.mock("../../../context/SettingsContext", () => ({
  useSettings: () => ({ detailSectionVisible: {}, showDeckVerified: true }),
}));

function pageItems(page: "game" | "storeGame"): OrderListItem[] {
  return (interfacePageDef(page)?.items ?? []).map((key) => ({
    id: key,
    label: key,
    icon: WIDGET_ICON[key],
    hidden: false,
  }));
}

const noop = () => {};

function renderPreview(page: "game" | "storeGame") {
  return render(
    <DetailPagePreview
      scope={page === "game" ? "game" : "store"}
      inspectMode={false}
      widgetItems={pageItems(page)}
      heroElementItems={[]}
      detailTabItems={[]}
      detailTopBarItems={[]}
      onReorderWidgets={noop}
      onToggleWidget={noop}
      onReorderHeroElements={noop}
      onToggleHeroElement={noop}
      onReorderDetailTabs={noop}
      onToggleDetailTab={noop}
      onReorderDetailTopBar={noop}
      onToggleDetailTopBar={noop}
    />,
  );
}

describe("DetailPagePreview — DLC card", () => {
  it("renders the DLC card in the library game preview", () => {
    renderPreview("game");
    expect(screen.getByText("gameDlcCard")).toBeInTheDocument();
  });

  it("renders the DLC card in the store game preview", () => {
    renderPreview("storeGame");
    expect(screen.getByText("gameDlcCard")).toBeInTheDocument();
  });
});

describe("DetailPagePreview — Save Backups card", () => {
  it("renders the save backups card in the library game preview", () => {
    renderPreview("game");
    expect(screen.getByText("gameSaveBackup")).toBeInTheDocument();
  });

  it("omits the save backups card from the store game preview", () => {
    renderPreview("storeGame");
    expect(screen.queryByText("gameSaveBackup")).toBeNull();
  });
});
