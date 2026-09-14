import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  Grid2x2,
  GripVertical,
  HardDrive,
  LayoutGrid,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  HERO_GRID_ITEM_KEYS,
  findHeroGridOverlaps,
  sortHeroGridItems,
  type HeroGridItemKey,
  type HeroGridLayout,
} from "../../../context/heroGrid";
import {
  WIDGET_LABEL_KEY,
  type DetailTabScope,
  type HeroElementKey,
  type PageWidgetKey,
} from "../../../context/interfaceLayout";
import type { DetailSectionKey } from "../../../context/SettingsContext";
import DetailSectionsHiddenNote from "../../../components/game/DetailSectionsHiddenNote";
import { useOrderDrag } from "../useOrderDrag";
import { useHeroGridDrag } from "./useHeroGridDrag";
import { WIDGET_ICON } from "./widgetIcons";
import type { OrderListItem } from "./types";

/** Stable no-op so the grid hook always has a commit target, even read-only. */
function noopGridChange() {}

/**
 * DetailPagePreview — a faithful schematic of the Game / Store detail page.
 *
 * The real pages are one shell: a cinematic hero, a segmented tab bar, a
 * quick-stats command bar, then a two-column body. Every card is its own
 * `PageWidget`, and the preview carries them in the exact regions the pages
 * themselves use:
 *
 *   Full   gameHero · gameTabs · gameQuickStats
 *   Main   gameAbout · gameStoryline · gameMedia · gameSysReq · gameRelations
 *   Side   gamePulse (library only), then the nine sidebar cards:
 *          gameInfoKpi · gameSteamFeatures · gameRatings · gameTimeToBeat ·
 *          gameSpecsCard · gameProtonDb · gameCrackwatch · gameReleases ·
 *          gameLanguages
 *
 *   `game` (library detail) is fully widget-addressable. `storeGame` (store
 *   detail) shares the side cards as real `PageWidgetSlot page="storeGame"`
 *   widgets, so its side column is interactive too; its hero/tab/stats shell
 *   and main column remain a static mirror.
 *
 * Reordering stays pointer-driven through the shared `useOrderDrag`: widget
 * rows carry `data-order-index` and the whole detail root is the drag
 * container. While a widget drag is in flight the hero/tab mock internals are
 * frozen (`is-frozen`) so their own nested drag rows can't steal the pointer.
 */

// ── Region maps (mirrors the real pages) ─────────────────────────────────────

const GAME_FULL_WIDGETS: PageWidgetKey[] = ["gameHero", "gameTabs", "gameQuickStats"];
const GAME_MAIN_WIDGETS: PageWidgetKey[] = [
  "gameAbout",
  "gameStoryline",
  "gameMedia",
  "gameSysReq",
  "gameRelations",
];
/**
 * The nine individual sidebar cards, in the order both detail pages ship them.
 * Each is a real `PageWidget` now (the old `gameSidebarKpis` / `gameSpecs`
 * group widgets are gone), so each becomes its own draggable / hideable card.
 */
const SIDE_CARD_WIDGETS: PageWidgetKey[] = [
  "gameInfoKpi",
  "gameSteamFeatures",
  "gameRatings",
  "gameTimeToBeat",
  "gameSpecsCard",
  "gameProtonDb",
  "gameCrackwatch",
  "gameReleases",
  "gameLanguages",
];

/** The library game page leads its side column with the activity pulse. */
const GAME_SIDE_WIDGETS: PageWidgetKey[] = ["gamePulse", ...SIDE_CARD_WIDGETS];

/** The store detail has no activity pulse — the same cards without it. */
const STORE_MAIN_WIDGETS: PageWidgetKey[] = GAME_MAIN_WIDGETS;
const STORE_SIDE_WIDGETS: PageWidgetKey[] = SIDE_CARD_WIDGETS;

/** The exact `sections` lists the real pages hand to DetailSectionsHiddenNote. */
const GAME_HIDDEN_NOTE_SECTIONS: DetailSectionKey[] = [
  "steamFeatures",
  "systemRequirements",
  "gameRelations",
  "timeToBeat",
  "protonDb",
  "releases",
  "reviews",
  "activity",
  "notes",
  "achievements",
  "mods",
  "weblinks",
  "news",
];
const STORE_HIDDEN_NOTE_SECTIONS: DetailSectionKey[] = [
  "steamFeatures",
  "systemRequirements",
  "gameRelations",
  "timeToBeat",
  "protonDb",
  "releases",
  "reviews",
  "achievements",
  "weblinks",
  "news",
];

/**
 * The resolved per-element grid layout for the scope, or `null`/`undefined`
 * when no grid has been authored (the hero renders its flex/`order` layout).
 * The mock uses it both as the render source and as the drag origin.
 */
export type HeroPlacement = HeroGridLayout;

// ── Schematic building blocks ────────────────────────────────────────────────

/** One grey placeholder line (a paragraph line, a label, a value…). */
function Line({ w }: { w: number }) {
  return <i className="studio-detail-line" style={{ width: `${w}%` }} aria-hidden="true" />;
}

function Lines({ ws }: { ws: number[] }) {
  return (
    <span className="studio-detail-lines">
      {ws.map((w, i) => (
        <Line key={i} w={w} />
      ))}
    </span>
  );
}

function MediaBody() {
  return (
    <span className="studio-detail-media">
      <span className="studio-detail-media__hero" aria-hidden="true" />
      <span className="studio-detail-media__thumbs">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="studio-detail-media__thumb" aria-hidden="true" />
        ))}
      </span>
    </span>
  );
}

function ColsBody() {
  return (
    <span className="studio-detail-cols">
      {[0, 1].map((col) => (
        <span key={col} className="studio-detail-col">
          <span className="studio-detail-pill" aria-hidden="true" />
          <Line w={88} />
          <Line w={70} />
          <Line w={80} />
        </span>
      ))}
    </span>
  );
}

function PostersBody() {
  return (
    <span className="studio-detail-posters">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="studio-detail-poster" aria-hidden="true" />
      ))}
    </span>
  );
}

function PulseBody() {
  const bars = [34, 58, 42, 76, 52, 88, 64, 46, 72, 38];
  return (
    <span className="studio-detail-pulse">
      <span className="studio-detail-spark" aria-hidden="true">
        {bars.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
      </span>
      <span className="studio-detail-pulse__row">
        <Line w={38} />
        <Line w={24} />
      </span>
    </span>
  );
}

/** A KPI tile sample: icon square + label / value bars, optional footer bar. */
function MiniTile({ footer }: { footer?: ReactNode }) {
  return (
    <span className="studio-detail-kpi">
      <span className="studio-detail-kpi__icon" aria-hidden="true" />
      <span className="studio-detail-kpi__text">
        <Line w={64} />
        <Line w={42} />
        {footer}
      </span>
    </span>
  );
}

/** A progress track with an accent fill (ratings breakdown, time to beat). */
function Track({ value }: { value: number }) {
  return (
    <span className="studio-detail-track" aria-hidden="true">
      <span className="studio-detail-track__fill" style={{ width: `${value}%` }} />
    </span>
  );
}

/** Definition rows: label bar on the left, value bar on the right. */
function MetaRows({ count, label, value }: { count: number; label: number; value: number }) {
  return (
    <span className="studio-detail-rows">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="studio-detail-row">
          <Line w={label} />
          <Line w={value} />
        </span>
      ))}
    </span>
  );
}

/** Info card: status / playtime / size tiles over the metadata list. */
function InfoKpiBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-kpi-tiles">
        <MiniTile />
        <MiniTile />
        <MiniTile />
      </span>
      <MetaRows count={3} label={38} value={30} />
    </span>
  );
}

/** Steam Features: the store feature list. */
function SteamFeaturesBody() {
  return (
    <span className="studio-detail-feature-list">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="studio-detail-feature">
          <span className="studio-detail-feature__icon" aria-hidden="true" />
          <Line w={74} />
        </span>
      ))}
    </span>
  );
}

/** Ratings: score tiles over the four-row score breakdown. */
function RatingsBody() {
  const breakdown = [72, 56, 24, 9];
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-kpi-tiles">
        <MiniTile />
        <MiniTile />
      </span>
      <span className="studio-detail-breakdown">
        {breakdown.map((value, i) => (
          <span key={i} className="studio-detail-breakdown__row">
            <span className="studio-detail-breakdown__label" aria-hidden="true" />
            <Track value={value} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Time to beat: one tile per play style, each with its progress bar. */
function TimeToBeatBody() {
  const progress = [58, 32, 14];
  return (
    <span className="studio-detail-kpi-tiles studio-detail-kpi-tiles--stack">
      {progress.map((value, i) => (
        <MiniTile key={i} footer={<Track value={value} />} />
      ))}
    </span>
  );
}

/** Specs card: pill groups for modes / themes / perspectives. */
function SpecsBody() {
  return (
    <span className="studio-detail-mini-body">
      {[0, 1].map((group) => (
        <span key={group} className="studio-detail-spec-group">
          <span className="studio-detail-spec-group__label" aria-hidden="true" />
          <span className="studio-detail-pills">
            {[0, 1, 2].map((pill) => (
              <span key={pill} className="studio-detail-tag" aria-hidden="true" />
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/** ProtonDB: compatibility tier badge over its report metadata. */
function ProtonDbBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-badge studio-detail-badge--tier" aria-hidden="true" />
      <MetaRows count={3} label={34} value={26} />
    </span>
  );
}

/** CrackWatch: cracked / uncracked status pill over its crack metadata. */
function CrackWatchBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-badge studio-detail-badge--status" aria-hidden="true" />
      <MetaRows count={2} label={36} value={26} />
    </span>
  );
}

/** Releases: one row per platform / date entry. */
function ReleasesBody() {
  return <MetaRows count={4} label={40} value={28} />;
}

/** Languages: a language column with three support-flag columns. */
function LanguagesBody() {
  return (
    <span className="studio-detail-lang">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="studio-detail-lang__row">
          <Line w={68} />
          <span className="studio-detail-lang__dot" aria-hidden="true" />
          <span className="studio-detail-lang__dot is-on" aria-hidden="true" />
          <span className="studio-detail-lang__dot" aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}

/** Widget key → schematic content that hints at the real card's shape. */
function WidgetBody({ widget }: { widget: PageWidgetKey }) {
  switch (widget) {
    case "gameStoryline":
      return <Lines ws={[96, 90, 72]} />;
    case "gameMedia":
      return <MediaBody />;
    case "gameSysReq":
      return <ColsBody />;
    case "gameRelations":
      return <PostersBody />;
    case "gamePulse":
      return <PulseBody />;
    // The nine individual sidebar cards, each its own widget slot now.
    case "gameInfoKpi":
      return <InfoKpiBody />;
    case "gameSteamFeatures":
      return <SteamFeaturesBody />;
    case "gameRatings":
      return <RatingsBody />;
    case "gameTimeToBeat":
      return <TimeToBeatBody />;
    case "gameSpecsCard":
      return <SpecsBody />;
    case "gameProtonDb":
      return <ProtonDbBody />;
    case "gameCrackwatch":
      return <CrackWatchBody />;
    case "gameReleases":
      return <ReleasesBody />;
    case "gameLanguages":
      return <LanguagesBody />;
    case "gameAbout":
    default:
      return <Lines ws={[100, 94, 86, 58]} />;
  }
}

/** Overview quick-stats command bar — five equal glass tiles. */
const QUICK_STAT_ICONS: LucideIcon[] = [Star, Clock, HardDrive, CalendarDays, ShieldCheck];

function QuickStatsStrip() {
  return (
    <div className="studio-detail-qstats" aria-hidden="true">
      {QUICK_STAT_ICONS.map((Icon, i) => (
        <span key={i} className="studio-detail-qstat">
          <span className="studio-detail-qstat__icon">
            <Icon size={12} />
          </span>
          <span className="studio-detail-qstat__body">
            <span className="studio-detail-qstat__label" />
            <span className="studio-detail-qstat__value" />
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Hero mock (self-contained, modular) ──────────────────────────────────────

/** Tiny stand-in for a content element inside the hero mock. */
function HeroElementVisual({ element }: { element: HeroElementKey }) {
  switch (element) {
    case "title":
      return <span className="studio-hero-visual studio-hero-visual--title" aria-hidden="true" />;
    case "meta":
      return (
        <span className="studio-hero-visual studio-hero-visual--meta" aria-hidden="true">
          <i />
          <i />
        </span>
      );
    case "genres":
      return (
        <span className="studio-hero-visual studio-hero-visual--genres" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      );
    case "kpis":
      return (
        <span className="studio-hero-visual studio-hero-visual--kpis" aria-hidden="true">
          {[0, 1, 2].map((tile) => (
            <span key={tile} className="studio-hero-kpi">
              <span className="studio-hero-kpi__header">
                <span className="studio-hero-kpi__icon" />
                <span className="studio-hero-kpi__label" />
              </span>
              <span className="studio-hero-kpi__value" />
            </span>
          ))}
        </span>
      );
    case "actions":
      return (
        <span className="studio-hero-visual studio-hero-visual--actions" aria-hidden="true">
          <i />
          <i />
        </span>
      );
    default:
      return null;
  }
}

interface HeroMockProps {
  items: OrderListItem[];
  inspectMode: boolean;
  highlightedId?: string | null;
  /** Disable the hero's own drag rows while a page-widget drag is in flight. */
  frozen: boolean;
  /** Authored 12-column layout; null/undefined => the flex/`order` layout. */
  placement?: HeroPlacement;
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onInspect?: (id: string) => void;
  /** Commit an edited grid (drag release or keyboard nudge). */
  onGridChange?: (next: HeroGridLayout) => void;
  /** Repack the grid to the shipped layout. */
  onGridTidy?: () => void;
  /** Drop back to the flex/`order` layout. */
  onGridReset?: () => void;
  /** Seed a grid from the current flex order. */
  onGridConvert?: () => void;
}

/**
 * HeroMock — the editable stand-in for `GameHero`, kept as one self-contained
 * node.
 *
 * In **flex mode** (no authored grid) it mirrors the real hero's inline-`order`
 * model: the poster docks left or right relative to the content column, the
 * content blocks stack in the persisted order, and an adjacent trailing
 * kpis+actions pair collapses into a footer row pinned to the bottom.
 *
 * In **grid mode** the same elements become cells on a fixed 12-column track,
 * rendered from the authored rect and edited with pointer capture + keyboard:
 *   • drag the element body (or its grip) to move,
 *   • drag the right / bottom / corner handle to resize,
 *   • Arrow keys nudge by a cell, Alt+Arrow resizes,
 *   • overlap is allowed and only flagged.
 * The toolbar above the card offers guides, tidy, reset-to-flex and (from flex)
 * convert-to-grid.
 */
function HeroMock({
  items,
  inspectMode,
  highlightedId,
  frozen,
  placement,
  onReorder,
  onToggle,
  onInspect,
  onGridChange,
  onGridTidy,
  onGridReset,
  onGridConvert,
}: HeroMockProps) {
  const { t } = useLanguage();
  const drag = useOrderDrag(onReorder);
  const [showGuides, setShowGuides] = useState(false);

  const gridMode = !!placement;
  const gridEditable = gridMode && !!onGridChange;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridDrag = useHeroGridDrag({
    layout: placement ?? null,
    onChange: onGridChange ?? noopGridChange,
    gridRef,
  });
  const renderedGrid = gridDrag.preview ?? placement ?? null;

  const byKey = new Map(items.map((item) => [item.id, item]));
  const index = (key: string) => items.findIndex((item) => item.id === key);
  const backgroundItem = byKey.get("background");
  const posterItem = byKey.get("poster");

  const contentOrderKeys = ["title", "meta", "genres", "kpis", "actions"]
    .filter((key) => byKey.has(key))
    .sort((a, b) => index(a) - index(b));

  const kpisPos = contentOrderKeys.indexOf("kpis");
  const actionsPos = contentOrderKeys.indexOf("actions");
  const groupFooter =
    kpisPos !== -1 && actionsPos !== -1 && Math.abs(kpisPos - actionsPos) === 1;

  let trailingStart = contentOrderKeys.length;
  while (trailingStart > 0) {
    const key = contentOrderKeys[trailingStart - 1];
    if (key === "kpis" || key === "actions") trailingStart--;
    else break;
  }
  const pinTrailingFooter = trailingStart < contentOrderKeys.length && trailingStart > 0;
  const boundaryKey = pinTrailingFooter ? contentOrderKeys[trailingStart] : null;
  const contentOrder = contentOrderKeys.length
    ? Math.min(...contentOrderKeys.map((key) => index(key)))
    : Number.POSITIVE_INFINITY;
  const posterOrder = index("poster");

  // Grid mode: which cells exist, their reading order, and whether any pair
  // intersects (flagged, never auto-corrected).
  const gridKeysPresent = HERO_GRID_ITEM_KEYS.filter((key) => byKey.has(key));
  const orderedGridKeys = renderedGrid
    ? sortHeroGridItems(renderedGrid, gridKeysPresent)
    : gridKeysPresent;
  const overlapKeys = useMemo(() => {
    const set = new Set<HeroGridItemKey>();
    if (!renderedGrid) return set;
    for (const [a, b] of findHeroGridOverlaps(renderedGrid)) {
      set.add(a);
      set.add(b);
    }
    return set;
  }, [renderedGrid]);
  const hasOverlap = overlapKeys.size > 0;

  const elementClass = (base: string, item: OrderListItem) => {
    const i = index(item.id);
    const isDragging = drag.dragIndex === i;
    const isDropTarget =
      drag.overIndex === i && drag.dragIndex !== null && drag.dragIndex !== i;
    return [
      base,
      item.hidden ? "is-off" : "",
      isDragging ? "is-dragging" : "",
      isDropTarget ? "is-drop-target" : "",
      highlightedId === item.id ? "is-preview-lit" : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  const title = (label: string, hidden: boolean) =>
    inspectMode
      ? `${label} — ${t("settings.interface.inspectElementHint")}`
      : `${label} — ${t(hidden ? "settings.interface.studioShow" : "settings.interface.studioHide")}`;

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || inspectMode) return;
    drag.startDrag(i);
  };

  const interact = (id: string, toggle: () => void) => {
    if (drag.movedRef.current || gridDrag.movedRef.current) return;
    if (inspectMode && onInspect) onInspect(id);
    else toggle();
  };

  const renderEye = (item: OrderListItem) => {
    const label = title(item.label, item.hidden);
    return (
      <button
        type="button"
        className="studio-hero-mock__eye"
        aria-label={label}
        title={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (inspectMode && onInspect) onInspect(item.id);
          else onToggle(item.id, !item.hidden);
        }}
      >
        {item.hidden ? <EyeOff size={10} aria-hidden="true" /> : <Eye size={10} aria-hidden="true" />}
      </button>
    );
  };

  const renderItem = (key: string, pinned = false) => {
    const item = byKey.get(key);
    if (!item) return null;
    const i = index(key);
    return (
      <div
        key={key}
        data-order-index={i}
        className={elementClass(`studio-hero-mock__item studio-hero-mock__item--${key}`, item)}
        style={{ order: i, marginTop: pinned ? "auto" : undefined }}
        title={title(item.label, item.hidden)}
        onPointerDown={startDrag(i)}
        onClick={() => interact(item.id, () => onToggle(item.id, !item.hidden))}
      >
        <HeroElementVisual element={item.id as HeroElementKey} />
        {renderEye(item)}
      </div>
    );
  };

  const renderPoster = () => {
    if (!posterItem) return null;
    const i = index("poster");
    return (
      <div
        data-order-index={i}
        className={elementClass(
          "studio-hero-mock__item studio-hero-mock__item--poster studio-hero-mock__poster",
          posterItem,
        )}
        style={{ order: posterOrder }}
        title={title(posterItem.label, posterItem.hidden)}
        onPointerDown={startDrag(i)}
        onClick={() => interact(posterItem.id, () => onToggle(posterItem.id, !posterItem.hidden))}
      >
        <span className="studio-hero-mock__poster-art" aria-hidden="true" />
        <span className="studio-hero-mock__poster-badge" aria-hidden="true" />
        {renderEye(posterItem)}
      </div>
    );
  };

  /** Place a grid cell by its rect, expressed as CSS custom properties. */
  const gridStyle = (key: HeroGridItemKey): CSSProperties => {
    const p = renderedGrid![key];
    return {
      "--hero-col": p.col,
      "--hero-col-span": p.colSpan,
      "--hero-row": p.row,
      "--hero-row-span": p.rowSpan,
    } as CSSProperties;
  };

  const renderGridItem = (key: HeroGridItemKey) => {
    const item = byKey.get(key);
    if (!item) return null;
    const className = [
      `studio-hero-mock__item studio-hero-mock__grid-item studio-hero-mock__grid-item--${key}`,
      item.hidden ? "is-off" : "",
      gridDrag.activeKey === key ? "is-dragging" : "",
      overlapKeys.has(key) ? "is-overlapping" : "",
      highlightedId === item.id ? "is-preview-lit" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const itemTitle = inspectMode
      ? `${item.label} — ${t("settings.interface.inspectElementHint")}`
      : gridEditable
        ? `${title(item.label, item.hidden)} — ${t("settings.interface.heroGridMoveHint")}`
        : title(item.label, item.hidden);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!gridEditable) return;
      // Only the cell itself owns the arrow keys — a key pressed on the nested
      // eye button must not also nudge the cell.
      if (e.target !== e.currentTarget) return;
      const resize = e.altKey;
      let dCol = 0;
      let dRow = 0;
      if (e.key === "ArrowLeft") dCol = -1;
      else if (e.key === "ArrowRight") dCol = 1;
      else if (e.key === "ArrowUp") dRow = -1;
      else if (e.key === "ArrowDown") dRow = 1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      gridDrag.nudge(key, dCol, dRow, resize);
    };

    return (
      <div
        key={key}
        data-hero-grid-key={key}
        role="group"
        tabIndex={gridEditable ? 0 : -1}
        className={className}
        style={gridStyle(key)}
        title={itemTitle}
        aria-label={itemTitle}
        onPointerDown={
          gridEditable && !inspectMode ? gridDrag.startMove(key) : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          interact(item.id, () => onToggle(item.id, !item.hidden));
        }}
        onKeyDown={handleKeyDown}
      >
        {key === "poster" ? (
          <>
            <span className="studio-hero-mock__poster-art" aria-hidden="true" />
            <span className="studio-hero-mock__poster-badge" aria-hidden="true" />
          </>
        ) : (
          <HeroElementVisual element={item.id as HeroElementKey} />
        )}

        {gridEditable && (
          <span className="studio-hero-mock__grid-grip" aria-hidden="true">
            <GripVertical size={10} />
          </span>
        )}

        {renderEye(item)}

        {gridEditable && (
          <>
            <span
              className="studio-hero-mock__grid-resize studio-hero-mock__grid-resize--e"
              title={t("settings.interface.heroGridResize")}
              aria-hidden="true"
              onPointerDown={gridDrag.startResize(key, "e")}
            />
            <span
              className="studio-hero-mock__grid-resize studio-hero-mock__grid-resize--s"
              title={t("settings.interface.heroGridResize")}
              aria-hidden="true"
              onPointerDown={gridDrag.startResize(key, "s")}
            />
            <span
              className="studio-hero-mock__grid-resize studio-hero-mock__grid-resize--se"
              title={t("settings.interface.heroGridResize")}
              aria-hidden="true"
              onPointerDown={gridDrag.startResize(key, "se")}
            />
          </>
        )}
      </div>
    );
  };

  const mockClassName = [
    "studio-hero-mock",
    inspectMode ? "is-inspect" : "",
    frozen ? "is-frozen" : "",
    gridMode ? "is-grid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`studio-hero-editor${gridMode ? " is-grid-mode" : ""}`}>
      {(gridMode || onGridConvert) && (
        <div
          className="studio-hero-editor__toolbar"
          role="group"
          aria-label={t("settings.interface.heroGridTitle")}
        >
          <span className="studio-hero-editor__label">
            <LayoutGrid size={11} aria-hidden="true" />
            {t("settings.interface.heroGridTitle")}
          </span>

          {gridMode ? (
            <>
              <button
                type="button"
                className={`studio-hero-editor__chip${showGuides ? " is-active" : ""}`}
                aria-pressed={showGuides}
                title={t("settings.interface.heroGridShowGuides")}
                onClick={() => setShowGuides((v) => !v)}
              >
                <Grid2x2 size={11} aria-hidden="true" />
                <span>{t("settings.interface.heroGridShowGuides")}</span>
              </button>
              {onGridTidy && (
                <button
                  type="button"
                  className="studio-hero-editor__chip"
                  title={t("settings.interface.heroGridTidy")}
                  onClick={onGridTidy}
                >
                  <WandSparkles size={11} aria-hidden="true" />
                  <span>{t("settings.interface.heroGridTidy")}</span>
                </button>
              )}
              {onGridReset && (
                <button
                  type="button"
                  className="studio-hero-editor__chip"
                  title={t("settings.interface.heroGridReset")}
                  onClick={onGridReset}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  <span>{t("settings.interface.heroGridReset")}</span>
                </button>
              )}
            </>
          ) : (
            onGridConvert && (
              <button
                type="button"
                className="studio-hero-editor__chip"
                title={t("settings.interface.heroGridConvert")}
                onClick={onGridConvert}
              >
                <Grid2x2 size={11} aria-hidden="true" />
                <span>{t("settings.interface.heroGridConvert")}</span>
              </button>
            )
          )}

          {hasOverlap && (
            <span className="studio-hero-editor__warning" role="status">
              <TriangleAlert size={11} aria-hidden="true" />
              {t("settings.interface.heroGridOverlapWarning")}
            </span>
          )}

          <span className="studio-sr-only" aria-live="polite">
            {gridDrag.statusMessage}
          </span>
        </div>
      )}

      <div
        className={mockClassName}
        role="group"
        ref={gridMode ? undefined : drag.containerRef}
        aria-label={t("settings.interface.studioHeroElementsTitle")}
      >
        {backgroundItem && (
          <>
            <span
              className={elementClass("studio-hero-mock__bg", backgroundItem)}
              data-order-index={index("background")}
              aria-hidden="true"
            />
            <span className="studio-hero-mock__scrim" aria-hidden="true" />
            <button
              type="button"
              className="studio-hero-mock__bg-eye"
              data-order-index={index("background")}
              aria-label={title(backgroundItem.label, backgroundItem.hidden)}
              title={title(backgroundItem.label, backgroundItem.hidden)}
              onPointerDown={startDrag(index("background"))}
              onClick={() =>
                interact(backgroundItem.id, () => onToggle(backgroundItem.id, !backgroundItem.hidden))
              }
            >
              {backgroundItem.hidden ? (
                <EyeOff size={11} aria-hidden="true" />
              ) : (
                <Eye size={11} aria-hidden="true" />
              )}
            </button>
          </>
        )}

        {gridMode ? (
          <div className="studio-hero-grid" ref={gridRef}>
            {(showGuides || gridDrag.activeKey !== null) && (
              <span className="studio-hero-grid__guides" aria-hidden="true" />
            )}
            {orderedGridKeys.map(renderGridItem)}
          </div>
        ) : (
          <div className="studio-hero-mock__inner">
            {renderPoster()}

            <div className="studio-hero-mock__content" style={{ order: contentOrder }}>
              {groupFooter ? (
                <>
                  <div
                    key="footer"
                    className="studio-hero-mock__footer"
                    style={{
                      order: Math.min(index("kpis"), index("actions")),
                      marginTop:
                        pinTrailingFooter && (boundaryKey === "kpis" || boundaryKey === "actions")
                          ? "auto"
                          : undefined,
                    }}
                  >
                    {renderItem("kpis")}
                    {renderItem("actions")}
                  </div>
                  {contentOrderKeys
                    .filter((key) => key !== "kpis" && key !== "actions")
                    .map((key) => renderItem(key, pinTrailingFooter && boundaryKey === key))}
                </>
              ) : (
                contentOrderKeys.map((key) =>
                  renderItem(key, pinTrailingFooter && boundaryKey === key),
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail tab bar mock ──────────────────────────────────────────────────────

interface DetailTabBarProps {
  items: OrderListItem[];
  inspectMode: boolean;
  highlightedId?: string | null;
  frozen: boolean;
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onInspect?: (id: string) => void;
}

/** Editable stand-in for `GameTabs` — overview stays visible. */
function DetailTabBar({
  items,
  inspectMode,
  highlightedId,
  frozen,
  onReorder,
  onToggle,
  onInspect,
}: DetailTabBarProps) {
  const { t } = useLanguage();
  const drag = useOrderDrag(onReorder);

  const title = (item: OrderListItem) =>
    inspectMode
      ? `${item.label} — ${t("settings.interface.inspectElementHint")}`
      : item.id === "overview"
        ? `${item.label} — ${t("settings.interface.studioAlwaysVisible")}`
        : `${item.label} — ${t(
            item.hidden ? "settings.interface.studioShow" : "settings.interface.studioHide",
          )}`;

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || inspectMode) return;
    drag.startDrag(i);
  };

  return (
    <div
      className={`studio-subtab-bar${frozen ? " is-frozen" : ""}`}
      role="group"
      ref={drag.containerRef}
      aria-label={t("settings.interface.studioDetailTabsTitle")}
    >
      {items.map((item, i) => {
        const isLit = highlightedId === item.id;
        const isDragging = drag.dragIndex === i;
        const isDropTarget = drag.overIndex === i && drag.dragIndex !== null && drag.dragIndex !== i;
        const className = [
          "studio-subtab",
          item.hidden ? "is-off" : "",
          isDragging ? "is-dragging" : "",
          isDropTarget ? "is-drop-target" : "",
          isLit ? "is-preview-lit" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={item.id}
            type="button"
            data-order-index={i}
            className={className}
            aria-pressed={!item.hidden}
            title={title(item)}
            onPointerDown={startDrag(i)}
            onClick={() => {
              if (drag.movedRef.current) return;
              if (inspectMode && onInspect) onInspect(item.id);
              else if (item.id !== "overview") onToggle(item.id, !item.hidden);
            }}
          >
            <GripVertical className="studio-preview__grip" size={10} aria-hidden="true" />
            <item.icon size={11} className="studio-preview__tab-icon" aria-hidden="true" />
            <span className="studio-preview__tab-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Detail top-bar mock ──────────────────────────────────────────────────────

interface DetailTopBarProps {
  items: OrderListItem[];
  inspectMode: boolean;
  highlightedId?: string | null;
  frozen: boolean;
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onInspect?: (id: string) => void;
}

/**
 * Editable stand-in for the real `.game-top-bar`. Mirrors the page's flat,
 * order-driven markup: the `back` chip carries `margin-inline-end: auto` so it
 * pins to the inline start and the action chips cluster at the inline end.
 * Hidden buttons stay in place (dimmed) so they can be switched back on.
 */
function DetailTopBar({
  items,
  inspectMode,
  highlightedId,
  frozen,
  onReorder,
  onToggle,
  onInspect,
}: DetailTopBarProps) {
  const { t } = useLanguage();
  const drag = useOrderDrag(onReorder);

  const title = (item: OrderListItem) =>
    inspectMode
      ? `${item.label} — ${t("settings.interface.inspectElementHint")}`
      : `${item.label} — ${t(
          item.hidden ? "settings.interface.studioShow" : "settings.interface.studioHide",
        )}`;

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || inspectMode) return;
    drag.startDrag(i);
  };

  return (
    <div
      className={`studio-detail-topbar${frozen ? " is-frozen" : ""}`}
      role="group"
      ref={drag.containerRef}
      aria-label={t("settings.interface.studioTopBarTitle")}
    >
      {items.map((item, i) => {
        const isBack = item.id === "back";
        const isDragging = drag.dragIndex === i;
        const isDropTarget = drag.overIndex === i && drag.dragIndex !== null && drag.dragIndex !== i;
        const className = [
          "studio-detail-topbar__item",
          isBack ? "studio-detail-topbar__item--back" : "studio-detail-topbar__item--action",
          item.hidden ? "is-off" : "",
          isDragging ? "is-dragging" : "",
          isDropTarget ? "is-drop-target" : "",
          highlightedId === item.id ? "is-preview-lit" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={item.id}
            type="button"
            data-order-index={i}
            className={className}
            aria-pressed={!item.hidden}
            title={title(item)}
            onPointerDown={startDrag(i)}
            onClick={() => {
              if (drag.movedRef.current) return;
              if (inspectMode && onInspect) onInspect(item.id);
              else onToggle(item.id, !item.hidden);
            }}
          >
            <GripVertical className="studio-preview__grip" size={10} aria-hidden="true" />
            <item.icon size={12} className="studio-detail-topbar__icon" aria-hidden="true" />
            <span className="studio-detail-topbar__label">{item.label}</span>
            {item.hidden && (
              <EyeOff size={11} className="studio-detail-topbar__off" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Full-width widget slot (hero / tabs / quick stats) ───────────────────────

interface FullSlotProps {
  item: OrderListItem;
  index: number;
  className: string;
  slotTitle: string;
  dragTitle: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onToggle: () => void;
  /** Only the stat bar toggles on click; the hero/tabs own their inner clicks. */
  onActivate?: () => void;
  children: ReactNode;
}

function FullSlot({
  item,
  index,
  className,
  slotTitle,
  dragTitle,
  onPointerDown,
  onToggle,
  onActivate,
  children,
}: FullSlotProps) {
  const { t } = useLanguage();
  const eyeTitle =
    item.hidden ? t("settings.interface.studioShow") : t("settings.interface.studioHide");
  return (
    <div
      id={`studio-item-${item.id}`}
      data-order-index={index}
      className={className}
      title={slotTitle}
    >
      <div className="studio-detail-slot__bar">
        <span className="studio-detail-slot__grip" title={dragTitle} onPointerDown={onPointerDown}>
          <GripVertical size={11} aria-hidden="true" />
        </span>
        <item.icon size={11} className="studio-detail-slot__icon" aria-hidden="true" />
        <span className="studio-detail-slot__label">{item.label}</span>
        <button
          type="button"
          className="studio-detail-slot__eye"
          aria-label={eyeTitle}
          title={eyeTitle}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {item.hidden ? <EyeOff size={11} aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />}
        </button>
      </div>
      <div
        className="studio-detail-slot__visual"
        onClick={onActivate}
        role={onActivate ? "button" : undefined}
      >
        {children}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface DetailPagePreviewProps {
  scope: DetailTabScope;
  inspectMode: boolean;
  highlightedId?: string | null;
  /** The active page's ordered widgets — the drag / toggle source. */
  widgetItems: OrderListItem[];
  heroElementItems: OrderListItem[];
  detailTabItems: OrderListItem[];
  detailTopBarItems: OrderListItem[];
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onReorderHeroElements: (from: number, to: number) => void;
  onToggleHeroElement: (id: string, hidden: boolean) => void;
  onReorderDetailTabs: (from: number, to: number) => void;
  onToggleDetailTab: (id: string, hidden: boolean) => void;
  onReorderDetailTopBar: (from: number, to: number) => void;
  onToggleDetailTopBar: (id: string, hidden: boolean) => void;
  onInspectElement?: (id: string) => void;
  /** Authored 12-column hero layout for the scope; null/undefined => flex. */
  heroPlacement?: HeroPlacement;
  /** Commit a hero grid edit (drag release or keyboard nudge). */
  onHeroGridChange?: (next: HeroGridLayout) => void;
  /** Repack the hero grid to the shipped layout. */
  onHeroGridTidy?: () => void;
  /** Drop the hero grid and go back to flex. */
  onHeroGridReset?: () => void;
  /** Seed a hero grid from the current flex order. */
  onHeroGridConvert?: () => void;
}

export function DetailPagePreview({
  scope,
  inspectMode,
  highlightedId,
  widgetItems,
  heroElementItems,
  detailTabItems,
  detailTopBarItems,
  onReorderWidgets,
  onToggleWidget,
  onReorderHeroElements,
  onToggleHeroElement,
  onReorderDetailTabs,
  onToggleDetailTab,
  onReorderDetailTopBar,
  onToggleDetailTopBar,
  onInspectElement,
  heroPlacement,
  onHeroGridChange,
  onHeroGridTidy,
  onHeroGridReset,
  onHeroGridConvert,
}: DetailPagePreviewProps) {
  const { t } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);
  const draggingWidgets = widgetDrag.dragIndex !== null;

  const indexOf = (id: string) => widgetItems.findIndex((item) => item.id === id);
  const gameScope = scope === "game";

  const title = (label: string, hidden: boolean) =>
    inspectMode
      ? `${label} — ${t("settings.interface.inspectElementHint")}`
      : `${label} — ${t(hidden ? "settings.interface.studioShow" : "settings.interface.studioHide")}`;

  const cardClass = (base: string, id: string, hidden: boolean, index: number) => {
    const isDragging = widgetDrag.dragIndex === index;
    const isDropTarget =
      widgetDrag.overIndex === index &&
      widgetDrag.dragIndex !== null &&
      widgetDrag.dragIndex !== index;
    return [
      base,
      hidden ? "is-off" : "",
      isDragging ? "is-dragging" : "",
      isDropTarget ? "is-drop-target" : "",
      highlightedId === id ? "is-preview-lit" : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  const startWidgetDrag = (index: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || inspectMode || index < 0) return;
    widgetDrag.startDrag(index);
  };

  const interactWidget = (id: string, toggle: () => void) => {
    if (widgetDrag.movedRef.current) return;
    if (inspectMode && onInspectElement) onInspectElement(id);
    else toggle();
  };

  const heroMock = (
    <HeroMock
      items={heroElementItems}
      inspectMode={inspectMode}
      highlightedId={highlightedId}
      frozen={draggingWidgets}
      placement={heroPlacement}
      onReorder={onReorderHeroElements}
      onToggle={onToggleHeroElement}
      onInspect={onInspectElement}
      onGridChange={onHeroGridChange}
      onGridTidy={onHeroGridTidy}
      onGridReset={onHeroGridReset}
      onGridConvert={onHeroGridConvert}
    />
  );

  const tabBar = (
    <DetailTabBar
      items={detailTabItems}
      inspectMode={inspectMode}
      highlightedId={highlightedId}
      frozen={draggingWidgets}
      onReorder={onReorderDetailTabs}
      onToggle={onToggleDetailTab}
      onInspect={onInspectElement}
    />
  );

  /** Interactive widget card (detail pages), styled like the real `.game-section`. */
  const renderCard = (item: OrderListItem) => {
    const index = indexOf(item.id);
    const label = title(item.label, item.hidden);
    return (
      <button
        key={item.id}
        type="button"
        id={`studio-item-${item.id}`}
        data-order-index={index}
        className={cardClass("studio-detail-card", item.id, item.hidden, index)}
        title={label}
        onPointerDown={startWidgetDrag(index)}
        onClick={() => interactWidget(item.id, () => onToggleWidget(item.id))}
      >
        <span className="studio-detail-card__head">
          <GripVertical className="studio-detail-card__grip" size={11} aria-hidden="true" />
          <item.icon size={13} className="studio-detail-card__icon" aria-hidden="true" />
          <span className="studio-detail-card__title">{item.label}</span>
          {item.hidden && (
            <EyeOff size={11} className="studio-detail-card__off" aria-hidden="true" />
          )}
        </span>
        <span className="studio-detail-card__body">
          <WidgetBody widget={item.id as PageWidgetKey} />
        </span>
      </button>
    );
  };

  /** Static mirror of a card the real store-detail shell doesn't expose as a
   *  widget (the store main column). */
  const renderStaticCard = (key: PageWidgetKey) => {
    const Icon = WIDGET_ICON[key] ?? Sparkles;
    const label = t(WIDGET_LABEL_KEY[key]);
    return (
      <div
        key={key}
        className="studio-detail-card is-static"
        title={`${label} — ${t("settings.interface.studioAlwaysVisible")}`}
      >
        <span className="studio-detail-card__head">
          <Icon size={13} className="studio-detail-card__icon" aria-hidden="true" />
          <span className="studio-detail-card__title">{label}</span>
        </span>
        <span className="studio-detail-card__body">
          <WidgetBody widget={key} />
        </span>
      </div>
    );
  };

  const renderFullSlot = (item: OrderListItem) => {
    const index = indexOf(item.id);
    const isStats = item.id === "gameQuickStats";
    return (
      <FullSlot
        key={item.id}
        item={item}
        index={index}
        className={cardClass("studio-detail-slot", item.id, item.hidden, index)}
        slotTitle={title(item.label, item.hidden)}
        dragTitle={t("settings.interface.studioDragHandle")}
        onPointerDown={startWidgetDrag(index)}
        onToggle={() =>
          inspectMode && onInspectElement
            ? onInspectElement(item.id)
            : onToggleWidget(item.id)
        }
        onActivate={
          isStats
            ? () =>
                interactWidget(item.id, () => onToggleWidget(item.id))
            : undefined
        }
      >
        {item.id === "gameHero" ? heroMock : item.id === "gameTabs" ? tabBar : <QuickStatsStrip />}
      </FullSlot>
    );
  };

  const fullItems = widgetItems.filter((item) =>
    GAME_FULL_WIDGETS.includes(item.id as PageWidgetKey),
  );
  const mainItems = widgetItems.filter((item) =>
    GAME_MAIN_WIDGETS.includes(item.id as PageWidgetKey),
  );
  const sideRegion = scope === "store" ? STORE_SIDE_WIDGETS : GAME_SIDE_WIDGETS;
  const sideItems = widgetItems.filter((item) =>
    sideRegion.includes(item.id as PageWidgetKey),
  );

  return (
    <div
      className={`studio-detail studio-detail--${scope}`}
      ref={widgetDrag.containerRef}
      data-scope={scope}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* Top bar: the buttons above the hero — before the hero, as shipped.
       *  The list is already platform-filtered upstream, so a scope whose keys
       *  are all gated away simply renders no bar rather than an empty shell. */}
      {detailTopBarItems.length > 0 && (
        <DetailTopBar
          items={detailTopBarItems}
          inspectMode={inspectMode}
          highlightedId={highlightedId}
          frozen={draggingWidgets}
          onReorder={onReorderDetailTopBar}
          onToggle={onToggleDetailTopBar}
          onInspect={onInspectElement}
        />
      )}

      {/* Full-width shell: hero, tab bar, quick stats — in the page's real order.
       *  The library game page is fully widget-addressable; the store detail's
       *  shell stays a static mirror. */}
      <div className="studio-detail__full">
        {gameScope ? (
          fullItems.map(renderFullSlot)
        ) : (
          <>
            <div className="studio-detail-slot studio-detail-slot--static">{heroMock}</div>
            <div className="studio-detail-slot studio-detail-slot--static">{tabBar}</div>
            <div className="studio-detail-slot studio-detail-slot--static">
              <QuickStatsStrip />
            </div>
          </>
        )}
      </div>

      {/* Two-column body, at the real `.game-content-grid` proportions. */}
      <div className="studio-detail-grid">
        <div className="studio-detail-main">
          {/* The real note renders nothing until a listed section is hidden,
           *  which is exactly how the live pages behave. */}
          <DetailSectionsHiddenNote
            sections={
              scope === "store" ? STORE_HIDDEN_NOTE_SECTIONS : GAME_HIDDEN_NOTE_SECTIONS
            }
          />
          {gameScope ? mainItems.map(renderCard) : STORE_MAIN_WIDGETS.map(renderStaticCard)}
        </div>
        {/* The side cards are their own `PageWidget`s on both detail pages, so
         *  they are addressed interactively for the store detail too. */}
        <div className="studio-detail-side">{sideItems.map(renderCard)}</div>
      </div>
    </div>
  );
}
