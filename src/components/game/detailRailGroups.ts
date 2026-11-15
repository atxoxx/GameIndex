import type { ComponentType } from "react";
import type { PageWidgetKey } from "../../context/interfaceLayout";
import { IconDlc, IconInfo, IconPlay, IconShield, IconStar } from "./icons";

/**
 * Grouped side rail for the Library and Store detail pages.
 *
 *  Both pages used to stack every side card in one flat column — 13 cards on
 *  the Library page — so nothing read as more important than anything else.
 *  Each card keeps its own Layout Studio widget key; the groups only decide
 *  which panel a card sits in, so per-card visibility and ordering still work.
 *
 *  Group order is not fixed here: `DetailRail` positions a group at the
 *  earliest stored index among its visible members, which keeps the Layout
 *  Studio's flat order meaningful even though the rail is now hierarchical.
 */

export interface DetailRailGroupDef {
  /** Stable id, used for the persisted open/closed state. */
  id: string;
  /** i18n key for the panel header. */
  labelKey: string;
  /** Header glyph. */
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Cards inside the panel, in shipped order. */
  widgets: PageWidgetKey[];
  /** First visit shows the panel expanded when true. */
  defaultOpen: boolean;
}

/**
 * Cards that Simple UI mode leaves out. Filtering happens before a group is
 * measured so a panel that only held these collapses away instead of showing
 * an empty header — the previous markup gated them with `.ui-complete-only`.
 */
export const SIMPLE_UI_HIDDEN_WIDGETS: ReadonlySet<PageWidgetKey> = new Set([
  "gameSpecsCard",
  "gameProtonDb",
  "gameCrackwatch",
  "gameReleases",
  "gameLanguages",
]);

/**
 * Library game page.
 *
 *  The overview starts with the ownership/status snapshot (`gameQuickStats`
 *  now rides here as a compact panel instead of a full-width card row), then
 *  the play record. Everything reference-heavy stays folded on first visit so
 *  the column does not read as an endless stack.
 */
export const GAME_RAIL_GROUPS: DetailRailGroupDef[] = [
  {
    id: "copy",
    labelKey: "game.rail.copy",
    icon: IconInfo,
    widgets: ["gameInfoKpi"],
    defaultOpen: true,
  },
  {
    id: "play",
    labelKey: "game.rail.play",
    icon: IconPlay,
    widgets: ["gamePulse", "gameSaveBackup"],
    defaultOpen: true,
  },
  {
    id: "game",
    labelKey: "game.rail.game",
    icon: IconStar,
    widgets: [
      "gameRatings",
      "gameTimeToBeat",
      "gameValue",
      "gameDlcCard",
      "gameSteamFeatures",
      "gameProtonDb",
      "gameCrackwatch",
    ],
    defaultOpen: false,
  },
];

/** Store detail page: content first, then reference and compatibility. */
export const STORE_RAIL_GROUPS: DetailRailGroupDef[] = [
  {
    id: "content",
    labelKey: "store.rail.content",
    icon: IconDlc,
    widgets: ["gameDlcCard", "gameSteamFeatures", "gameReleases", "gameLanguages"],
    defaultOpen: true,
  },
  {
    id: "glance",
    labelKey: "store.rail.glance",
    icon: IconInfo,
    widgets: ["gameInfoKpi", "gameRatings", "gameTimeToBeat"],
    // The product header and purchase panel already carry the public score,
    // price and release facts, so the reference panel stays folded.
    defaultOpen: false,
  },
  {
    id: "compat",
    labelKey: "store.rail.compat",
    icon: IconShield,
    widgets: ["gameProtonDb", "gameCrackwatch", "gameSpecsCard"],
    defaultOpen: false,
  },
];
