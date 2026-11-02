import {
  type ReactNode,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  GripVertical,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Maximize2,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Trophy,
  Users,
  Wallpaper,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  type DetailTabScope,
  type HeroElementKey,
  type PageWidgetKey,
} from "../../../context/interfaceLayout";
import type { DetailSectionKey } from "../../../context/SettingsContext";
import DetailSectionsHiddenNote from "../../../components/game/DetailSectionsHiddenNote";
import { useOrderDrag } from "../useOrderDrag";
import type { OrderListItem } from "./types";
import "./DetailPagePreview.css";

/**
 * DetailPagePreview — a faithful schematic of the Game / Store detail page.
 *
 * The real pages are one shell: the floating top bar, a cinematic hero, a tab
 * strip, a quick-stats command bar, the hidden-sections note, then a
 * two-column body. Every card is its own `PageWidget`, and the preview carries
 * them in the exact regions the pages themselves use:
 *
 *   Full   gameHero · gameTabs · gameQuickStats   (+ the full-width note)
 *   Main   gameMedia · gameAbout · gameStoryline · gameSysReq · gameRelations
 *   Side   gamePulse (library only), then the sidebar cards:
 *          gameInfoKpi · gameDlcCard · gameSteamFeatures · gameValue (library
 *          only) · gameSaveBackup (library only) · gameRatings ·
 *          gameTimeToBeat · gameSpecsCard · gameProtonDb · gameCrackwatch ·
 *          gameReleases · gameLanguages
 *
 *   The live side column groups those cards into collapsible panels
 *   (`DetailRail` + `detailRailGroups`); the preview lists them flat because
 *   each card is a drag target here, and grouping would hide cards behind a
 *   panel the user is also trying to reorder.
 *
 *   Both scopes are fully widget-addressable: `game` (library detail) and
 *   `storeGame` (store detail) render the same `PageWidget` /
 *   `PageWidgetSlot` wrapper set, so every card can be hidden and reordered
 *   here for either page. The scope still drives what the mock draws, because
 *   the pages themselves differ: the store detail has no activity pulse, save
 *   backup or value card, its hero runs the compact profile without the
 *   playtime/achievement stats or the friends strip, its quick-stats row drops
 *   the value and last-played metrics, and its Info card hides the play-status
 *   tile and the executable path.
 *
 * Reordering stays pointer-driven through the shared `useOrderDrag`: widget
 * rows carry `data-order-index` and the whole detail root is the drag
 * container. While a widget drag is in flight the hero/tab mock internals are
 * frozen (`is-frozen`) so their own nested drag rows can't steal the pointer.
 */

// ── Region maps (mirrors the real pages) ─────────────────────────────────────

const GAME_FULL_WIDGETS: PageWidgetKey[] = ["gameHero", "gameTabs", "gameQuickStats"];
/** Reading-column membership, in the order `.game-main-col` mounts them. The
 *  rendered order still comes from the persisted widget list. */
const GAME_MAIN_WIDGETS: PageWidgetKey[] = [
  "gameMedia",
  "gameAbout",
  "gameStoryline",
  "gameSysReq",
  "gameRelations",
];
/**
 * The library side column, in the order `GAME_RAIL_GROUPS` ships it.
 * Each card is a real `PageWidget`, so each becomes its own draggable /
 * hideable card. `gamePulse`, `gameSaveBackup` and `gameValue` are
 * library-only — the store detail has no activity, save or value card.
 */
const GAME_SIDE_WIDGETS: PageWidgetKey[] = [
  "gamePulse",
  "gameInfoKpi",
  "gameDlcCard",
  "gameSteamFeatures",
  "gameValue",
  "gameSaveBackup",
  "gameRatings",
  "gameTimeToBeat",
  "gameSpecsCard",
  "gameProtonDb",
  "gameCrackwatch",
  "gameReleases",
  "gameLanguages",
];

/** The store detail's rail cards, in `STORE_RAIL_GROUPS` order: no pulse, no
 *  save backup, no value card. */
const STORE_SIDE_WIDGETS: PageWidgetKey[] = [
  "gameInfoKpi",
  "gameRatings",
  "gameTimeToBeat",
  "gameDlcCard",
  "gameSteamFeatures",
  "gameReleases",
  "gameLanguages",
  "gameProtonDb",
  "gameCrackwatch",
  "gameSpecsCard",
];

/** The exact `sections` lists the real pages hand to DetailSectionsHiddenNote. */
const GAME_HIDDEN_NOTE_SECTIONS: DetailSectionKey[] = [
  "dlc",
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
  "saves",
  "weblinks",
  "news",
  "map",
];
const STORE_HIDDEN_NOTE_SECTIONS: DetailSectionKey[] = [
  "dlc",
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
  "map",
];

/**
 * The hero mock renders the flex/`order` layout only — the same model the
 * real `GameHero` uses. Reordering and hiding are the two hero controls the
 * Layout Studio owns.
 */

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

/** Media spotlight: the counter/arrow header over the theatre and filmstrip. */
function MediaBody() {
  return (
    <span className="studio-detail-media">
      <span className="studio-detail-media__head">
        <Line w={26} />
        <span className="studio-detail-media__nav" aria-hidden="true">
          <ChevronLeft size={10} />
          <ChevronRight size={10} />
          <Maximize2 size={10} />
        </span>
      </span>
      <span className="studio-detail-media__hero" aria-hidden="true" />
      <span className="studio-detail-media__thumbs">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="studio-detail-media__thumb" aria-hidden="true" />
        ))}
      </span>
    </span>
  );
}

/** System requirements: the min / recommended toggle over the spec rows. */
function ColsBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-pills">
        <span className="studio-detail-tag studio-detail-tag--on" aria-hidden="true" />
        <span className="studio-detail-tag" aria-hidden="true" />
      </span>
      <MetaRows count={3} label={26} value={40} />
      <MetaRows count={4} label={30} value={34} />
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

/** Franchise & similar: a relation group header over its card row. */
function RelationsBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-group">
        <span className="studio-detail-feature__icon" aria-hidden="true" />
        <Line w={40} />
        <Line w={12} />
      </span>
      <PostersBody />
    </span>
  );
}

/** Activity pulse: the view-all link over the two session / trophy boxes. */
function PulseBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-link studio-detail-link--end">
        <Line w={24} />
      </span>
      <span className="studio-detail-stats">
        <span className="studio-detail-stat">
          <span className="studio-detail-stat__head">
            <Clock size={11} aria-hidden="true" />
            <Line w={44} />
          </span>
          <span className="studio-detail-stat__value" aria-hidden="true" />
          <Line w={30} />
        </span>
        <span className="studio-detail-stat">
          <span className="studio-detail-stat__head">
            <Trophy size={11} aria-hidden="true" />
            <Line w={38} />
          </span>
          <span className="studio-detail-stat__value" aria-hidden="true" />
          <Track value={64} />
        </span>
      </span>
    </span>
  );
}

/** A KPI tile sample: icon square + label / value bars. */
function MiniTile() {
  return (
    <span className="studio-detail-kpi">
      <span className="studio-detail-kpi__icon" aria-hidden="true" />
      <span className="studio-detail-kpi__text">
        <Line w={64} />
        <Line w={42} />
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

/** Info card: status / playtime / size / price tiles over the metadata list. */
function InfoKpiBody({ scope }: { scope: DetailTabScope }) {
  // The store detail hides the play-status tile and has no executable path.
  const isStore = scope === "store";
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-kpi-tiles">
        {Array.from({ length: isStore ? 3 : 4 }, (_, i) => (
          <MiniTile key={i} />
        ))}
      </span>
      <MetaRows count={isStore ? 5 : 7} label={38} value={30} />
      {!isStore && (
        <span className="studio-detail-note">
          <FolderOpen size={11} aria-hidden="true" />
          <Line w={70} />
        </span>
      )}
      <span className="studio-detail-pills">
        {[0, 1, 2].map((i) => (
          <span key={i} className="studio-detail-tag" aria-hidden="true" />
        ))}
      </span>
    </span>
  );
}

/** Steam Features: feature rows, controller badges and the DRM notices. */
function SteamFeaturesBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-feature-list">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="studio-detail-feature">
            <span className="studio-detail-feature__icon" aria-hidden="true" />
            <Line w={74} />
          </span>
        ))}
      </span>
      <span className="studio-detail-pills">
        <span className="studio-detail-tag" aria-hidden="true" />
        <span className="studio-detail-tag" aria-hidden="true" />
      </span>
      <span className="studio-detail-note">
        <ShieldCheck size={11} aria-hidden="true" />
        <Line w={82} />
      </span>
    </span>
  );
}

/** Value for money: the $/hour rate, the library benchmark bar and fact rows. */
function ValueBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-rate">
        <span className="studio-detail-rate__value" aria-hidden="true" />
        <span className="studio-detail-badge studio-detail-badge--status" aria-hidden="true" />
      </span>
      <Track value={72} />
      <MetaRows count={2} label={44} value={28} />
    </span>
  );
}

/** DLC card: the owned badge over the preview rows and the view-all link. */
function DlcBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-pills">
        <span className="studio-detail-badge studio-detail-badge--tier" aria-hidden="true" />
      </span>
      <span className="studio-detail-feature-list">
        {[0, 1, 2].map((i) => (
          <span key={i} className="studio-detail-feature studio-detail-feature--dlc">
            <span className="studio-detail-feature__thumb" aria-hidden="true" />
            <Line w={52} />
            <span className="studio-detail-tag studio-detail-tag--status" aria-hidden="true" />
          </span>
        ))}
      </span>
      <span className="studio-detail-link">
        <Line w={30} />
      </span>
    </span>
  );
}

/** Save Backups: the manage link, snapshot chips and the action row. */
function SaveBackupBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-link studio-detail-link--end">
        <Line w={22} />
      </span>
      <span className="studio-detail-pills">
        <span className="studio-detail-badge studio-detail-badge--status" aria-hidden="true" />
        <Line w={16} />
      </span>
      <span className="studio-detail-note">
        <Clock size={11} aria-hidden="true" />
        <Line w={62} />
      </span>
      <span className="studio-detail-actions">
        <span className="studio-detail-btn studio-detail-btn--primary" aria-hidden="true" />
        <span className="studio-detail-btn" aria-hidden="true" />
      </span>
    </span>
  );
}

/** Ratings: score tiles over the segmented critic split and its legend. */
function RatingsBody() {
  const split = [
    { tone: "positive", value: 72 },
    { tone: "mixed", value: 19 },
    { tone: "negative", value: 9 },
  ];
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-kpi-tiles">
        {[0, 1, 2].map((i) => (
          <MiniTile key={i} />
        ))}
      </span>
      <span className="studio-detail-row studio-detail-row--flush">
        <Line w={30} />
        <Line w={16} />
      </span>
      <span className="studio-detail-track studio-detail-track--split">
        {split.map((segment) => (
          <span
            key={segment.tone}
            className={`studio-detail-seg studio-detail-seg--${segment.tone}`}
            style={{ width: `${segment.value}%` }}
          />
        ))}
      </span>
      <span className="studio-detail-legend">
        {split.map((segment) => (
          <span key={segment.tone} className="studio-detail-legend__row">
            <span
              className={`studio-detail-legend__dot studio-detail-legend__dot--${segment.tone}`}
              aria-hidden="true"
            />
            <Line w={34} />
            <Line w={10} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Time to beat: a tile per playstyle over the personal-progress summary. */
function TimeToBeatBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-kpi-tiles">
        {[0, 1, 2].map((i) => (
          <MiniTile key={i} />
        ))}
      </span>
      <span className="studio-detail-row studio-detail-row--flush">
        <Line w={26} />
        <Line w={14} />
      </span>
      <Track value={58} />
      <span className="studio-detail-row studio-detail-row--flush">
        <Line w={30} />
        <Line w={18} />
      </span>
    </span>
  );
}

/** Specs card: pill groups for modes / themes / perspectives. */
function SpecsBody() {
  return (
    <span className="studio-detail-mini-body">
      {[0, 1, 2].map((group) => (
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

/** ProtonDB: the tier badge, its report metadata and the source links. */
function ProtonDbBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-badge studio-detail-badge--tier" aria-hidden="true" />
      <MetaRows count={4} label={34} value={26} />
      <span className="studio-detail-pills">
        <span className="studio-detail-tag" aria-hidden="true" />
        <span className="studio-detail-tag" aria-hidden="true" />
      </span>
    </span>
  );
}

/** CrackWatch: cracked / uncracked status pill over its crack metadata. */
function CrackWatchBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-badge studio-detail-badge--status" aria-hidden="true" />
      <MetaRows count={3} label={36} value={26} />
    </span>
  );
}

/** Releases: one row per platform / date entry. */
function ReleasesBody() {
  return <MetaRows count={4} label={40} value={28} />;
}

/** Languages: the support-flag table with its head row and expand link. */
function LanguagesBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-search" aria-hidden="true">
        <Line w={44} />
      </span>
      <span className="studio-detail-lang">
        <span className="studio-detail-lang__row studio-detail-lang__head" aria-hidden="true">
          <Line w={80} />
          <Line w={100} />
          <Line w={100} />
          <Line w={100} />
        </span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="studio-detail-lang__row">
            <Line w={68} />
            <span className="studio-detail-lang__dot is-on" aria-hidden="true" />
            <span className="studio-detail-lang__dot" aria-hidden="true" />
            <span className="studio-detail-lang__dot is-on" aria-hidden="true" />
          </span>
        ))}
      </span>
      <span className="studio-detail-link">
        <Line w={26} />
      </span>
    </span>
  );
}

/** About: the source / language pills, the copy and the expand toggle. */
function AboutBody() {
  return (
    <span className="studio-detail-mini-body">
      <span className="studio-detail-pills">
        <span className="studio-detail-tag" aria-hidden="true" />
        <span className="studio-detail-tag studio-detail-tag--muted" aria-hidden="true" />
      </span>
      <Lines ws={[100, 96, 88, 58]} />
      <span className="studio-detail-link">
        <Line w={20} />
        <ChevronDown size={10} aria-hidden="true" />
      </span>
    </span>
  );
}

/** Storyline: the quoted blurb. */
function StorylineBody() {
  return (
    <span className="studio-detail-quote">
      <Lines ws={[96, 90, 72]} />
    </span>
  );
}

/** Widget key → schematic content that hints at the real card's shape. */
function WidgetBody({ widget, scope }: { widget: PageWidgetKey; scope: DetailTabScope }) {
  switch (widget) {
    case "gameAbout":
      return <AboutBody />;
    case "gameStoryline":
      return <StorylineBody />;
    case "gameMedia":
      return <MediaBody />;
    case "gameSysReq":
      return <ColsBody />;
    case "gameRelations":
      return <RelationsBody />;
    case "gamePulse":
      return <PulseBody />;
    // The twelve individual sidebar cards, each its own widget slot now.
    case "gameInfoKpi":
      return <InfoKpiBody scope={scope} />;
    case "gameDlcCard":
      return <DlcBody />;
    case "gameSteamFeatures":
      return <SteamFeaturesBody />;
    case "gameValue":
      return <ValueBody />;
    case "gameSaveBackup":
      return <SaveBackupBody />;
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
    default:
      return <Lines ws={[100, 94, 86, 58]} />;
  }
}

// ── Overview quick-stats command bar ────────────────────────────────────────

/**
 * The metrics each scope's quick-stats row actually carries. The store page
 * runs `isStoreMode`, which drops the library-only value and last-played cards.
 * `compatibility` stays in both because it is gated on the Deck capability,
 * not on the scope.
 */
const QUICK_STATS: Record<
  DetailTabScope,
  { id: string; icon: LucideIcon; labelKey: string }[]
> = {
  game: [
    { id: "timeToBeat", icon: Clock, labelKey: "game.quickStats.timeToBeat" },
    { id: "storage", icon: HardDrive, labelKey: "game.quickStats.storage" },
    { id: "value", icon: Tag, labelKey: "game.quickStats.value" },
    { id: "compatibility", icon: ShieldCheck, labelKey: "game.quickStats.compatibility" },
    { id: "lastPlayed", icon: CalendarDays, labelKey: "game.quickStats.lastPlayed" },
  ],
  store: [
    { id: "timeToBeat", icon: Clock, labelKey: "game.quickStats.timeToBeat" },
    { id: "storage", icon: HardDrive, labelKey: "game.quickStats.storage" },
    { id: "compatibility", icon: ShieldCheck, labelKey: "game.quickStats.compatibility" },
  ],
};

/** One metric card of the quick-stats row (`.quick-stat-card` on the page). */
function QuickStatCard({ icon: Icon, labelKey }: { icon: LucideIcon; labelKey: string }) {
  const { t } = useLanguage();
  return (
    <span className="studio-detail-qstat studio-qstat">
      <span className="studio-qstat__head">
        <span className="studio-detail-qstat__icon">
          <Icon size={12} aria-hidden="true" />
        </span>
        <span className="studio-qstat__label">{t(labelKey)}</span>
      </span>
      <span className="studio-qstat__value" aria-hidden="true" />
      <span className="studio-qstat__detail" aria-hidden="true" />
    </span>
  );
}

/** Overview quick-stats command bar — the reception card + the scope's metrics. */
function QuickStatsStrip({ scope }: { scope: DetailTabScope }) {
  const { t } = useLanguage();
  const stats = QUICK_STATS[scope];
  return (
    <div className="studio-detail-qstats" aria-hidden="true">
      <span className="studio-detail-qstat studio-qstat studio-qstat--reception">
        <span className="studio-qstat__head">
          <span className="studio-detail-qstat__icon">
            <Star size={12} />
          </span>
          <span className="studio-qstat__label">{t("game.quickStats.reception")}</span>
          <span className="studio-qstat__source">{t("ratings.igdb")}</span>
        </span>
        <span className="studio-qstat__score">
          <span className="studio-qstat__score-value" />
          <span className="studio-qstat__score-unit">/ 100</span>
        </span>
        <span className="studio-qstat__sentiment">
          <span className="studio-qstat__sentiment-positive" style={{ width: "96%" }} />
        </span>
      </span>
      {stats.map((stat) => (
        <QuickStatCard key={stat.id} icon={stat.icon} labelKey={stat.labelKey} />
      ))}
    </div>
  );
}

// ── Hero mock (self-contained, modular) ──────────────────────────────────────

/**
 * The hairline stat row each hero variant ships: the library hero leads with
 * playtime and achievement progress, the store hero only has the public score
 * and the live player count.
 */
const HERO_STAT_ICONS: Record<DetailTabScope, LucideIcon[]> = {
  game: [Clock, ShieldCheck, Star, Users],
  store: [Star, Users],
};

/** Tiny stand-in for a content element inside the hero mock. */
function HeroElementVisual({
  element,
  scope,
}: {
  element: HeroElementKey;
  scope: DetailTabScope;
}) {
  switch (element) {
    case "title":
      return <span className="studio-hero-visual studio-hero-visual--title" aria-hidden="true" />;
    case "meta":
      // A row of meta fragments separated by dots (platform · release · source).
      return (
        <span className="studio-hero-visual studio-hero-meta" aria-hidden="true">
          <i />
          <span className="studio-hero-meta__dot" />
          <i />
        </span>
      );
    case "genres":
      // Genres stack above the friends-playing strip, and only the library
      // hero knows who is playing.
      return (
        <span className="studio-hero-visual studio-hero-genres" aria-hidden="true">
          <span className="studio-hero-genres__chips">
            <i />
            <i />
            <i />
          </span>
          {scope === "game" && (
            <span className="studio-hero-genres__friends">
              <span className="studio-hero-genres__friend" />
              <span className="studio-hero-genres__friend" />
              <i />
            </span>
          )}
        </span>
      );
    case "kpis":
      return (
        <span className="studio-hero-visual studio-hero-stats" aria-hidden="true">
          {HERO_STAT_ICONS[scope].map((Icon, stat) => (
            <span key={stat} className="studio-hero-stat">
              <Icon size={11} className="studio-hero-stat__icon" />
              <span className="studio-hero-stat__value" />
              <span className="studio-hero-stat__label" />
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
  scope: DetailTabScope;
  items: OrderListItem[];
  inspectMode: boolean;
  highlightedId?: string | null;
  /** Disable the hero's own drag rows while a page-widget drag is in flight. */
  frozen: boolean;
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onInspect?: (id: string) => void;
  showHeroTilt?: boolean;
  onToggleHeroTilt?: () => void;
  showHeroBackdropControls?: boolean;
  onToggleHeroBackdropControls?: () => void;
  showHeroInteractiveControls?: boolean;
  onToggleHeroInteractiveControls?: () => void;
}

/**
 * HeroMock — the editable stand-in for `GameHero`, kept as one self-contained
 * node. It mirrors the real hero's inline-`order` model: the poster docks left
 * or right relative to the content column, the content blocks stack in the
 * persisted order, and an adjacent trailing kpis+actions pair collapses into a
 * footer row pinned to the bottom.
 */
function HeroMock({
  scope,
  items,
  inspectMode,
  highlightedId,
  frozen,
  onReorder,
  onToggle,
  onInspect,
  showHeroTilt = true,
  onToggleHeroTilt,
  showHeroBackdropControls = true,
  onToggleHeroBackdropControls,
  showHeroInteractiveControls = true,
  onToggleHeroInteractiveControls,
}: HeroMockProps) {
  const { t } = useLanguage();
  const drag = useOrderDrag(onReorder);

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
    drag.startDrag(i, { x: e.clientX, y: e.clientY });
  };

  const interact = (id: string, toggle: () => void) => {
    if (drag.movedRef.current) return;
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
        <HeroElementVisual element={item.id as HeroElementKey} scope={scope} />
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
        {showHeroTilt && (
          <span className="studio-hero-mock__poster-sheen" aria-hidden="true" />
        )}
        {scope === "game" && (
          <span className="studio-hero-mock__poster-badge" aria-hidden="true" />
        )}
        {showHeroInteractiveControls && (
          <span className="studio-hero-mock__poster-inspect" aria-hidden="true">
            <Maximize2 size={8} />
          </span>
        )}
        {renderEye(posterItem)}
      </div>
    );
  };

  const mockClassName = [
    "studio-hero-mock",
    // The store hero runs the shorter, compact banner profile.
    scope === "store" ? "studio-hero-mock--store" : "",
    inspectMode ? "is-inspect" : "",
    frozen ? "is-frozen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="studio-hero-editor">
      <div
        className="studio-hero-editor__toolbar"
        role="group"
        aria-label={t("settings.interface.heroFeaturesTitle")}
      >
        <span className="studio-hero-editor__label">
          <Sparkles size={11} aria-hidden="true" />
          {t("settings.interface.heroFeaturesTitle")}
        </span>

        <button
          type="button"
          className={`studio-hero-editor__chip${showHeroTilt ? " is-active" : ""}`}
          aria-pressed={showHeroTilt}
          title={t("settings.appearance.heroTiltDesc")}
          onClick={onToggleHeroTilt}
        >
          <Layers size={11} aria-hidden="true" />
          <span>{t("settings.interface.heroTiltChip")}</span>
        </button>

        <button
          type="button"
          className={`studio-hero-editor__chip${showHeroBackdropControls ? " is-active" : ""}`}
          aria-pressed={showHeroBackdropControls}
          title={t("settings.appearance.heroBackdropControlsDesc")}
          onClick={onToggleHeroBackdropControls}
        >
          <Wallpaper size={11} aria-hidden="true" />
          <span>{t("settings.interface.heroBackdropControlsChip")}</span>
        </button>

        <button
          type="button"
          className={`studio-hero-editor__chip${showHeroInteractiveControls ? " is-active" : ""}`}
          aria-pressed={showHeroInteractiveControls}
          title={t("settings.appearance.heroInteractiveControlsDesc")}
          onClick={onToggleHeroInteractiveControls}
        >
          <MousePointerClick size={11} aria-hidden="true" />
          <span>{t("settings.interface.heroInteractiveControlsChip")}</span>
        </button>
      </div>

      <div
        className={mockClassName}
        role="group"
        ref={drag.containerRef}
        aria-label={t("settings.interface.studioHeroElementsTitle")}
      >
        {/* Backdrop Controls mockup in top-right */}
        <div
          className={`studio-hero-mock__backdrop-ctrls${!showHeroBackdropControls ? " is-off" : ""}`}
          title={`${t("settings.appearance.heroBackdropControlsTitle")} — ${t(
            showHeroBackdropControls
              ? "settings.interface.studioHide"
              : "settings.interface.studioShow",
          )}`}
          onClick={(e) => {
            e.stopPropagation();
            if (inspectMode && onInspect) onInspect("hero-backdrop-controls");
            else onToggleHeroBackdropControls?.();
          }}
        >
          <span className="studio-hero-mock__ctrl-btn" aria-hidden="true">
            <ChevronLeft size={9} />
          </span>
          <span className="studio-hero-mock__ctrl-count" aria-hidden="true">
            <ImageIcon size={9} />
            <span>1/3</span>
          </span>
          <span className="studio-hero-mock__ctrl-btn" aria-hidden="true">
            <ChevronRight size={9} />
          </span>
          <span className="studio-hero-mock__ctrl-divider" aria-hidden="true" />
          <span className="studio-hero-mock__ctrl-btn" aria-hidden="true">
            <Maximize2 size={9} />
          </span>
          <span className="studio-hero-mock__ctrl-btn" aria-hidden="true">
            <Copy size={9} />
          </span>
          <button
            type="button"
            className="studio-hero-mock__ctrl-eye"
            aria-label={t(
              showHeroBackdropControls
                ? "settings.interface.studioHide"
                : "settings.interface.studioShow",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleHeroBackdropControls?.();
            }}
          >
            {showHeroBackdropControls ? (
              <Eye size={9} aria-hidden="true" />
            ) : (
              <EyeOff size={9} aria-hidden="true" />
            )}
          </button>
        </div>

        {backgroundItem && (
          <>
            <span
              className={elementClass("studio-hero-mock__bg", backgroundItem)}
              data-order-index={index("background")}
              aria-hidden="true"
            />
            <span className="studio-hero-mock__scrim" aria-hidden="true" />
            {showHeroTilt && <span className="studio-hero-mock__spotlight" aria-hidden="true" />}
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
      </div>
    </div>
  );
}

// ── Detail tab bar mock ──────────────────────────────────────────────────────

/**
 * Sample tab counts, mirroring what the live strips print: the library page
 * shows session / note / achievement / link totals, the store page only the
 * website count (its achievement tab carries no badge).
 */
const TAB_SAMPLE_COUNT: Record<DetailTabScope, Partial<Record<string, number>>> = {
  game: { activity: 12, notes: 3, achievements: 48, weblinks: 4 },
  store: { weblinks: 4 },
};

interface DetailTabBarProps {
  scope: DetailTabScope;
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
  scope,
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
    drag.startDrag(i, { x: e.clientX, y: e.clientY });
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
        // Overview is the tab the page opens on, so the mock shows it active.
        const isActive = item.id === "overview";
        const count = item.hidden ? undefined : TAB_SAMPLE_COUNT[scope][item.id];
        const className = [
          "studio-subtab",
          isActive ? "is-active" : "",
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
            <span
              className="studio-preview__grip"
              title={t("settings.interface.studioDragHandle")}
              aria-hidden="true"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={10} />
            </span>
            <item.icon size={11} className="studio-preview__tab-icon" aria-hidden="true" />
            <span className="studio-preview__tab-label">{item.label}</span>
            {count != null && <span className="studio-subtab__count">{count}</span>}
            {item.id === "map" && !item.hidden && (
              <span className="studio-subtab__status" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Detail top-bar mock ──────────────────────────────────────────────────────

/** Top-bar keys that open an edit-modal section — the run `renderTopBar`
 *  chunks into one divided group. */
const EDIT_SHORTCUT_IDS = new Set([
  "editDetails",
  "editMedia",
  "editLaunch",
  "editCompatibility",
]);

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
 * Contiguous edit-modal shortcuts ride in one group with a leading divider,
 * exactly as `renderTopBar` chunks them. Hidden buttons stay in place (dimmed)
 * so they can be switched back on.
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
    drag.startDrag(i, { x: e.clientX, y: e.clientY });
  };

  const renderChip = (item: OrderListItem, i: number) => {
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
        <span
          className="studio-preview__grip"
          title={t("settings.interface.studioDragHandle")}
          aria-hidden="true"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={10} />
        </span>
        <item.icon size={12} className="studio-detail-topbar__icon" aria-hidden="true" />
        <span className="studio-detail-topbar__label">{item.label}</span>
        {item.hidden && (
          <EyeOff size={11} className="studio-detail-topbar__off" aria-hidden="true" />
        )}
      </button>
    );
  };

  // The page collects a contiguous run of edit shortcuts into one divided
  // group; every other key sits on its own and breaks the run.
  const nodes: ReactNode[] = [];
  let group: { item: OrderListItem; index: number }[] = [];
  let groupKey = "";
  const flushGroup = () => {
    if (group.length === 0) return;
    nodes.push(
      <span className="studio-detail-topbar__group" key={`edit-group:${groupKey}`}>
        {group.map(({ item, index }) => renderChip(item, index))}
      </span>,
    );
    group = [];
    groupKey = "";
  };
  items.forEach((item, i) => {
    if (EDIT_SHORTCUT_IDS.has(item.id)) {
      if (!groupKey) groupKey = item.id;
      group.push({ item, index: i });
      return;
    }
    flushGroup();
    nodes.push(renderChip(item, i));
  });
  flushGroup();

  return (
    <div
      className={`studio-detail-topbar${frozen ? " is-frozen" : ""}`}
      role="group"
      ref={drag.containerRef}
      aria-label={t("settings.interface.studioTopBarTitle")}
    >
      {nodes}
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
  showHeroTilt?: boolean;
  onToggleHeroTilt?: () => void;
  showHeroBackdropControls?: boolean;
  onToggleHeroBackdropControls?: () => void;
  showHeroInteractiveControls?: boolean;
  onToggleHeroInteractiveControls?: () => void;
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
  showHeroTilt = true,
  onToggleHeroTilt,
  showHeroBackdropControls = true,
  onToggleHeroBackdropControls,
  showHeroInteractiveControls = true,
  onToggleHeroInteractiveControls,
}: DetailPagePreviewProps) {
  const { t } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);
  const draggingWidgets = widgetDrag.dragIndex !== null;

  const indexOf = (id: string) => widgetItems.findIndex((item) => item.id === id);

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
    widgetDrag.startDrag(index, { x: e.clientX, y: e.clientY });
  };

  const interactWidget = (id: string, toggle: () => void) => {
    if (widgetDrag.movedRef.current) return;
    if (inspectMode && onInspectElement) onInspectElement(id);
    else toggle();
  };

  const heroMock = (
    <HeroMock
      scope={scope}
      items={heroElementItems}
      inspectMode={inspectMode}
      highlightedId={highlightedId}
      frozen={draggingWidgets}
      onReorder={onReorderHeroElements}
      onToggle={onToggleHeroElement}
      onInspect={onInspectElement}
      showHeroTilt={showHeroTilt}
      onToggleHeroTilt={onToggleHeroTilt}
      showHeroBackdropControls={showHeroBackdropControls}
      onToggleHeroBackdropControls={onToggleHeroBackdropControls}
      showHeroInteractiveControls={showHeroInteractiveControls}
      onToggleHeroInteractiveControls={onToggleHeroInteractiveControls}
    />
  );

  const tabBar = (
    <DetailTabBar
      scope={scope}
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
          <WidgetBody widget={item.id as PageWidgetKey} scope={scope} />
        </span>
      </button>
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
        {item.id === "gameHero" ? (
          heroMock
        ) : item.id === "gameTabs" ? (
          tabBar
        ) : (
          <QuickStatsStrip scope={scope} />
        )}
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
       *  Both detail pages expose these as real `PageWidget`s, so both are
       *  draggable/toggleable here. The library page also drops the Steam
       *  family-sharing banner between the hero and the tabs; it is
       *  data-conditional and has no widget key, so it is not drawn. */}
      <div className="studio-detail__full">
        {fullItems.map(renderFullSlot)}
      </div>

      {/* The hidden-sections note sits full width above the two-column body,
       *  exactly where the live pages mount it. It renders nothing until a
       *  listed section is hidden, which is how the pages behave too. */}
      <DetailSectionsHiddenNote
        sections={
          scope === "store" ? STORE_HIDDEN_NOTE_SECTIONS : GAME_HIDDEN_NOTE_SECTIONS
        }
      />

      {/* Two-column body, at the real `.game-content-grid` proportions. */}
      <div className="studio-detail-grid">
        <div className="studio-detail-main">{mainItems.map(renderCard)}</div>
        {/* The side cards are their own `PageWidget`s on both detail pages, so
         *  they are addressed interactively for the store detail too. The live
         *  side column groups them into collapsible rail panels; the preview
         *  keeps them flat so every card stays a drag target. */}
        <div className="studio-detail-side">{sideItems.map(renderCard)}</div>
      </div>
    </div>
  );
}
