import { useEffect, useId, useState } from "react";
import type { FocusEvent, JSX, ReactNode } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Gamepad2,
  HardDrive,
  Layers,
  LayoutGrid,
  Library,
  Lock,
  MousePointerClick,
  PanelLeft,
  Scale,
  ShieldAlert,
  Star,
  Store,
  Wallpaper,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  SIDEBAR_SECTIONS,
  type InterfacePageKey,
} from "../../../context/interfaceLayout";
import { BADGE_ITEMS, MASTER_GATED_BADGES, WIDGET_ITEMS } from "../interfaceItems";
import type { OrderListItem } from "./types";
import "./StudioInspector.css";

/** Per-badge glyph, so a badge looks the same here as it does on a card. */
const BADGE_ICONS: Record<string, LucideIcon> = {
  badgePlatform: Store,
  badgePlaytime: Clock,
  badgeInstall: HardDrive,
  badgeRating: Star,
  badgeCrackwatch: ShieldAlert,
  badgeCompare: Scale,
};

/** Row ids gated by the "Show Card Badges" master (a string-keyed view). */
const GATED_BADGE_IDS: ReadonlySet<string> = new Set<string>(MASTER_GATED_BADGES);

export interface StudioInspectorProps {
  page: InterfacePageKey;
  scopeLabel: string;
  highlightedId?: string | null;
  onHoverElement?: (id: string | null) => void;

  /* header — only rendered when page === "global" */
  navTabItems: OrderListItem[];
  navButtonItems: OrderListItem[];
  showNowPlaying: boolean;
  onToggleNowPlaying: () => void;

  /* sidebar */
  sidebarPosition: "left" | "right";
  onSetSidebarPosition: (side: "left" | "right") => void;
  sidebarSectionVisible: Record<string, boolean>;
  onToggleSidebarSection: (id: string) => void;
  showSmartShelves: boolean;
  onToggleSmartShelves: () => void;

  /* library cards */
  globalVisibility: Record<string, boolean>;
  showCardBadges: boolean;
  onToggleCardBadgesMaster: () => void;
  onToggleGlobalItem: (id: string) => void;

  /* hero extras */
  showHeroTilt: boolean;
  onToggleHeroTilt: () => void;
  showHeroBackdropControls: boolean;
  onToggleHeroBackdropControls: () => void;
  showHeroInteractiveControls: boolean;
  onToggleHeroInteractiveControls: () => void;

  /* page blocks */
  pageItems: OrderListItem[];
  onTogglePageItem: (id: string) => void;
  onMovePageItem: (from: number, to: number) => void;

  /* detail lanes (game + storeGame only; pass empty arrays otherwise) */
  detailTabItems: OrderListItem[];
  onToggleDetailTab: (id: string, hidden: boolean) => void;
  onMoveDetailTab: (from: number, to: number) => void;
  heroElementItems: OrderListItem[];
  onToggleHeroElement: (id: string, hidden: boolean) => void;
  onMoveHeroElement: (from: number, to: number) => void;
  detailTopBarItems: OrderListItem[];
  onToggleDetailTopBar: (id: string, hidden: boolean) => void;
  onMoveDetailTopBar: (from: number, to: number) => void;
}

interface StudioRowProps {
  item: OrderListItem;
  index: number;
  total: number;
  kindKey: string;
  onToggle: () => void;
  onMove?: (from: number, to: number) => void;
  onHover?: (id: string | null) => void;
  disabled?: boolean;
  alwaysVisible?: boolean;
  highlightedId?: string | null;
}

function StudioRow({
  item,
  index,
  total,
  kindKey,
  onToggle,
  onMove,
  onHover,
  disabled,
  alwaysVisible,
  highlightedId,
}: StudioRowProps) {
  const { t } = useLanguage();
  const Icon = item.icon;
  const lit = highlightedId === item.id;

  const className = [
    "studio-row",
    item.hidden ? "is-off" : "",
    lit ? "is-preview-lit" : "",
  ]
    .filter(Boolean)
    .join(" ");

  /* Focus moves between this row's own controls; only clear the preview
     highlight once focus has actually left the row. */
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onHover?.(null);
  };

  return (
    <div
      id={`studio-row-${item.id}`}
      className={className}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(item.id)}
      onBlur={handleBlur}
    >
      <span className="studio-row__icon" aria-hidden="true">
        <Icon size={14} />
      </span>

      <span className="studio-row__text">
        <span className="studio-row__label" title={item.label}>
          {item.label}
        </span>
        <span className="studio-row__kind">{t(kindKey)}</span>
      </span>

      {alwaysVisible ? (
        <span className="studio-row__always">
          <Lock size={10} aria-hidden="true" />
          {t("settings.studio.rowAlwaysVisible")}
        </span>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={!item.hidden}
          aria-label={t(
            item.hidden ? "settings.studio.rowShow" : "settings.studio.rowHide",
            { name: item.label },
          )}
          className={`studio-row__switch${item.hidden ? "" : " is-on"}`}
          onClick={onToggle}
          disabled={disabled}
        />
      )}

      {onMove ? (
        <span className="studio-row__move">
          <button
            type="button"
            className="studio-row__move-btn"
            aria-label={t("settings.studio.rowMoveUp", { name: item.label })}
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
          >
            <ChevronUp size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="studio-row__move-btn"
            aria-label={t("settings.studio.rowMoveDown", { name: item.label })}
            onClick={() => onMove(index, index + 1)}
            disabled={index === total - 1}
          >
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </div>
  );
}

interface StudioGroupProps {
  titleKey: string;
  descKey: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Open the group while a search hit or preview hover points inside it. */
  forceOpen?: boolean;
}

function StudioGroup({
  titleKey,
  descKey,
  children,
  collapsible = false,
  defaultOpen,
  forceOpen = false,
}: StudioGroupProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const bodyId = useId();

  // A search hit or a hovered preview element opens the group and leaves it
  // open: closing it again when the highlight fades would hide the row the
  // user was just sent to.
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const expanded = collapsible ? open || forceOpen : true;

  return (
    <section className="studio-group">
      <h4 className="studio-group__head">
        {collapsible ? (
          <button
            type="button"
            className="studio-group__toggle"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="studio-group__title">{t(titleKey)}</span>
            <ChevronRight
              size={12}
              aria-hidden="true"
              className={`studio-group__chevron${expanded ? " is-open" : ""}`}
            />
          </button>
        ) : (
          <span className="studio-group__title">{t(titleKey)}</span>
        )}
      </h4>
      <p className="studio-group__desc">{t(descKey)}</p>
      {expanded ? (
        <div className="studio-group__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function StudioInspector({
  page,
  scopeLabel,
  highlightedId,
  onHoverElement,
  navTabItems,
  navButtonItems,
  showNowPlaying,
  onToggleNowPlaying,
  sidebarPosition,
  onSetSidebarPosition,
  sidebarSectionVisible,
  onToggleSidebarSection,
  showSmartShelves,
  onToggleSmartShelves,
  globalVisibility,
  showCardBadges,
  onToggleCardBadgesMaster,
  onToggleGlobalItem,
  showHeroTilt,
  onToggleHeroTilt,
  showHeroBackdropControls,
  onToggleHeroBackdropControls,
  showHeroInteractiveControls,
  onToggleHeroInteractiveControls,
  pageItems,
  onTogglePageItem,
  onMovePageItem,
  detailTabItems,
  onToggleDetailTab,
  onMoveDetailTab,
  heroElementItems,
  onToggleHeroElement,
  onMoveHeroElement,
  detailTopBarItems,
  onToggleDetailTopBar,
  onMoveDetailTopBar,
}: StudioInspectorProps): JSX.Element {
  const { t } = useLanguage();

  /* Rows whose switch is a plain "toggle this key" call. */
  const renderRows = (
    rows: OrderListItem[],
    kindKey: string,
    onToggle: (id: string) => void,
    onMove?: (from: number, to: number) => void,
    isDisabled?: (item: OrderListItem) => boolean,
  ) =>
    rows.map((item, index) => (
      <StudioRow
        key={item.id}
        item={item}
        index={index}
        total={rows.length}
        kindKey={kindKey}
        highlightedId={highlightedId}
        onHover={onHoverElement}
        onToggle={() => onToggle(item.id)}
        onMove={onMove}
        disabled={isDisabled?.(item)}
      />
    ));

  const sidebarRows: OrderListItem[] = SIDEBAR_SECTIONS.map((section) => ({
    id: section.key,
    label: t(section.labelKey),
    icon: PanelLeft,
    hidden: sidebarSectionVisible[section.key] === false,
  }));

  const smartShelvesRow: OrderListItem = {
    id: "smart-shelves",
    label: t("settings.interface.smartShelvesTitle"),
    icon: Library,
    hidden: !showSmartShelves,
  };

  const badgeRows: OrderListItem[] = BADGE_ITEMS.map((badge) => ({
    id: badge.key,
    label: t(badge.labelKey),
    icon: BADGE_ICONS[badge.key] ?? LayoutGrid,
    hidden: globalVisibility[badge.key] === false,
  }));

  const widgetRows: OrderListItem[] = WIDGET_ITEMS.map((widget) => ({
    id: widget.key,
    label: t(widget.labelKey),
    icon: LayoutGrid,
    hidden: globalVisibility[widget.key] === false,
  }));

  const heroExtraRows: { item: OrderListItem; onToggle: () => void }[] = [
    {
      item: {
        id: "hero-tilt",
        label: t("settings.interface.heroTiltChip"),
        icon: Layers,
        hidden: !showHeroTilt,
      },
      onToggle: onToggleHeroTilt,
    },
    {
      item: {
        id: "hero-backdrop-controls",
        label: t("settings.interface.heroBackdropControlsChip"),
        icon: Wallpaper,
        hidden: !showHeroBackdropControls,
      },
      onToggle: onToggleHeroBackdropControls,
    },
    {
      item: {
        id: "hero-interactive-controls",
        label: t("settings.interface.heroInteractiveControlsChip"),
        icon: MousePointerClick,
        hidden: !showHeroInteractiveControls,
      },
      onToggle: onToggleHeroInteractiveControls,
    },
  ];

  const nowPlayingRow: OrderListItem = {
    id: "now-playing",
    label: t("settings.appearance.navbarNowPlayingTitle"),
    icon: Gamepad2,
    hidden: !showNowPlaying,
  };

  const cardBadgesMasterRow: OrderListItem = {
    id: "show-card-badges",
    label: t("settings.appearance.cardBadgesTitle"),
    icon: BadgeCheck,
    hidden: !showCardBadges,
  };

  return (
    <aside className="studio-inspector">
      <div className="studio-inspector__head">
        <h3 className="studio-inspector__title">
          {t("settings.studio.inspectorTitle", { scope: scopeLabel })}
        </h3>
        <p className="studio-inspector__intro">{t("settings.studio.inspectorIntro")}</p>
      </div>

      {page === "global" ? (
        <>
          <StudioGroup
            titleKey="settings.studio.sectionHeaderTitle"
            descKey="settings.studio.sectionHeaderDesc"
          >
            {renderRows(navTabItems, "settings.studio.kindNavTab", onToggleGlobalItem)}
            {renderRows(navButtonItems, "settings.studio.kindNavButton", onToggleGlobalItem)}
            <StudioRow
              item={nowPlayingRow}
              index={0}
              total={1}
              kindKey="settings.studio.kindNavButton"
              highlightedId={highlightedId}
              onHover={onHoverElement}
              onToggle={onToggleNowPlaying}
            />
          </StudioGroup>

          <StudioGroup
            titleKey="settings.studio.sectionSidebarTitle"
            descKey="settings.studio.sectionSidebarDesc"
          >
            <div
              className="studio-inspector__segmented"
              role="group"
              aria-label={t("settings.studio.sectionSidebarTitle")}
            >
              <button
                type="button"
                className="studio-inspector__segment"
                aria-pressed={sidebarPosition === "left"}
                aria-label={t("settings.interface.studioSidebarLeft")}
                onClick={() => onSetSidebarPosition("left")}
              >
                {t("settings.interface.studioSidebarLeft")}
              </button>
              <button
                type="button"
                className="studio-inspector__segment"
                aria-pressed={sidebarPosition === "right"}
                aria-label={t("settings.interface.studioSidebarRight")}
                onClick={() => onSetSidebarPosition("right")}
              >
                {t("settings.interface.studioSidebarRight")}
              </button>
            </div>
            {renderRows(sidebarRows, "settings.studio.kindSidebar", onToggleSidebarSection)}
            <StudioRow
              item={smartShelvesRow}
              index={0}
              total={1}
              kindKey="settings.studio.kindAppBlock"
              highlightedId={highlightedId}
              onHover={onHoverElement}
              onToggle={onToggleSmartShelves}
            />
          </StudioGroup>

          <StudioGroup
            titleKey="settings.studio.sectionCardsTitle"
            descKey="settings.studio.sectionCardsDesc"
          >
            <StudioRow
              item={cardBadgesMasterRow}
              index={0}
              total={1}
              kindKey="settings.studio.kindBadge"
              highlightedId={highlightedId}
              onHover={onHoverElement}
              onToggle={onToggleCardBadgesMaster}
            />
            {renderRows(
              badgeRows,
              "settings.studio.kindBadge",
              onToggleGlobalItem,
              undefined,
              (item) => GATED_BADGE_IDS.has(item.id) && !showCardBadges,
            )}
          </StudioGroup>

          <StudioGroup
            titleKey="settings.studio.sectionBlocksTitle"
            descKey="settings.studio.sectionBlocksDesc"
          >
            {renderRows(widgetRows, "settings.studio.kindAppBlock", onToggleGlobalItem)}
          </StudioGroup>

          <StudioGroup
            titleKey="settings.studio.sectionHeroExtrasTitle"
            descKey="settings.studio.sectionHeroExtrasDesc"
            collapsible
            forceOpen={heroExtraRows.some(({ item }) => item.id === highlightedId)}
          >
            {heroExtraRows.map(({ item, onToggle }, index) => (
              <StudioRow
                key={item.id}
                item={item}
                index={index}
                total={heroExtraRows.length}
                kindKey="settings.studio.kindHeroExtra"
                highlightedId={highlightedId}
                onHover={onHoverElement}
                onToggle={onToggle}
              />
            ))}
          </StudioGroup>
        </>
      ) : (
        <>
          <StudioGroup
            titleKey="settings.studio.sectionPageBlocksTitle"
            descKey="settings.studio.sectionPageBlocksDesc"
          >
            {pageItems.length === 0 ? (
              <p className="studio-inspector__empty">
                {t("settings.studio.inspectorEmpty")}
              </p>
            ) : (
              renderRows(
                pageItems,
                "settings.studio.kindBlock",
                onTogglePageItem,
                onMovePageItem,
              )
            )}
          </StudioGroup>

          {detailTabItems.length > 0 ? (
            <StudioGroup
              titleKey="settings.studio.sectionDetailTabsTitle"
              descKey="settings.studio.sectionDetailTabsDesc"
            >
              {detailTabItems.map((item, index) => (
                <StudioRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={detailTabItems.length}
                  kindKey="settings.studio.kindDetailTab"
                  highlightedId={highlightedId}
                  onHover={onHoverElement}
                  alwaysVisible={item.id === "overview"}
                  onToggle={() => onToggleDetailTab(item.id, item.hidden)}
                  onMove={onMoveDetailTab}
                />
              ))}
            </StudioGroup>
          ) : null}

          {heroElementItems.length > 0 ? (
            <StudioGroup
              titleKey="settings.studio.sectionHeroTitle"
              descKey="settings.studio.sectionHeroDesc"
              collapsible
              forceOpen={heroElementItems.some((item) => item.id === highlightedId)}
            >
              {heroElementItems.map((item, index) => (
                <StudioRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={heroElementItems.length}
                  kindKey="settings.studio.kindHero"
                  highlightedId={highlightedId}
                  onHover={onHoverElement}
                  onToggle={() => onToggleHeroElement(item.id, item.hidden)}
                  onMove={onMoveHeroElement}
                />
              ))}
            </StudioGroup>
          ) : null}

          {detailTopBarItems.length > 0 ? (
            <StudioGroup
              titleKey="settings.studio.sectionTopBarTitle"
              descKey="settings.studio.sectionTopBarDesc"
              collapsible
              forceOpen={detailTopBarItems.some((item) => item.id === highlightedId)}
            >
              {detailTopBarItems.map((item, index) => (
                <StudioRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={detailTopBarItems.length}
                  kindKey="settings.studio.kindTopBar"
                  highlightedId={highlightedId}
                  onHover={onHoverElement}
                  onToggle={() => onToggleDetailTopBar(item.id, item.hidden)}
                  onMove={onMoveDetailTopBar}
                />
              ))}
            </StudioGroup>
          ) : null}
        </>
      )}
    </aside>
  );
}
