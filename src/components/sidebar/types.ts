import type { Game, PlayStatus } from "../../types/game";
import type { LibraryStatus, LibrarySort } from "../../hooks/useLibraryFilters";

/** Collapsed sections dictionary (e.g. pinned: true, recent: false, groupKey: true). */
export type SectionCollapseMap = Record<string, boolean>;

/** Available Group By strategies in the sidebar. */
export type SidebarGroupBy =
  | "none"
  | "platform"
  | "play_status"
  | "genre"
  | "letter"
  | "installed"
  | "decade";

/** Row visual density levels. */
export type SidebarDensity = "compact" | "standard" | "detailed";

/** Quick view presets in the top header. */
export type QuickFilterPreset = "all" | "installed" | "favorites" | "playing";

/** Sort direction. */
export type SidebarSortDirection = "asc" | "desc";

/** Fine-grained view options for customizing sidebar presentation. */
export interface SidebarViewOptions {
  groupBy: SidebarGroupBy;
  density: SidebarDensity;
  showPlaytime: boolean;
  showPlatformBadge: boolean;
  showAchievements: boolean;
  showRatings: boolean;
}

/** Aggregated library statistics shown in the sidebar footer. */
export interface SidebarStats {
  total: number;
  installed: number;
  playing: number;
  totalPlaytimeMinutes: number;
  favoriteCount: number;
}

/** Dynamic grouped section bucket for rendering. */
export interface SidebarGroup {
  key: string;
  title: string;
  count: number;
  icon?: React.ReactNode;
  badgeColor?: string;
  games: Game[];
}

/** Props for the HighlightedName text snippet component. */
export interface HighlightedNameProps {
  name: string;
  query: string;
}

/** Props for the search input row in the sidebar. */
export interface SidebarSearchProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onClear: () => void;
}

/** Props for the quick filter presets bar. */
export interface SidebarQuickFilterBarProps {
  activePreset: QuickFilterPreset;
  onSelectPreset: (preset: QuickFilterPreset) => void;
  counts: {
    all: number;
    installed: number;
    favorites: number;
    playing: number;
  };
}

/** Props for the view options dropdown (Group By, Sort, Density, etc.). */
export interface SidebarViewOptionsDropdownProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  groupBy: SidebarGroupBy;
  onGroupByChange: (groupBy: SidebarGroupBy) => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  sortDirection: SidebarSortDirection;
  onToggleSortDirection: () => void;
  density: SidebarDensity;
  onDensityChange: (density: SidebarDensity) => void;
  viewOptions: SidebarViewOptions;
  onToggleOption: (key: keyof SidebarViewOptions) => void;
  onExpandAllGroups?: () => void;
  onCollapseAllGroups?: () => void;
  hasGroups: boolean;
}

/** Props for the header bar in the sidebar. */
export interface SidebarHeaderProps {
  isIconRail: boolean;
  onToggleIconRail: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  advancedFilterCount: number;
  showFilterPopover: boolean;
  onToggleFilterPopover: () => void;
  filterButtonRef: React.RefObject<HTMLButtonElement | null>;
  importButtonRef: React.RefObject<HTMLButtonElement | null>;
  viewOptionsButtonRef: React.RefObject<HTMLButtonElement | null>;
  showImportMenu: boolean;
  importMenuAnchor: HTMLElement | null;
  onToggleImportMenu: (anchor: HTMLElement) => void;
  showViewOptionsMenu: boolean;
  onToggleViewOptionsMenu: (anchor: HTMLElement) => void;
  onImportExe: () => void;
  onImportFolder: () => void;
  onRandomGame: () => void;
  activeQuickPreset: QuickFilterPreset;
  onSelectQuickPreset: (preset: QuickFilterPreset) => void;
  quickPresetCounts: {
    all: number;
    installed: number;
    favorites: number;
    playing: number;
  };
  groupBy: SidebarGroupBy;
  onGroupByChange: (groupBy: SidebarGroupBy) => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  sortDirection: SidebarSortDirection;
  onToggleSortDirection: () => void;
  density: SidebarDensity;
  onDensityChange: (density: SidebarDensity) => void;
  viewOptions: SidebarViewOptions;
  onToggleViewOption: (key: keyof SidebarViewOptions) => void;
  onExpandAllGroups?: () => void;
  onCollapseAllGroups?: () => void;
  hasGroups: boolean;
}

/** Active filter chip data bundle for rendering and removal. */
export interface SidebarActiveFiltersProps {
  filterState: {
    status: LibraryStatus;
    source: string;
    playStatus: PlayStatus | "all";
    genres: string[];
    platforms: string[];
    yearMin: number | null;
    yearMax: number | null;
    ratingMin: number | null;
  };
  onRemoveStatus: () => void;
  onRemoveSource: () => void;
  onRemovePlayStatus: () => void;
  onRemoveGenre: (genre: string) => void;
  onRemovePlatform: (platform: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onReset: () => void;
}

/** Props for collapsible section headers (Pinned, Recently Played, Groups, All Games). */
export interface SidebarSectionHeaderProps {
  title: string;
  count: number;
  icon?: React.ReactNode;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  resultLabel?: string;
  badgeColor?: string;
}

/** Props for a single memoized row in the sidebar game list. */
export interface SidebarGameItemProps {
  game: Game;
  isSelected: boolean;
  isRunning: boolean;
  isPinned: boolean;
  bulkSelected: boolean;
  isRandomHighlight?: boolean;
  density?: SidebarDensity;
  viewOptions?: SidebarViewOptions;
  searchQuery: string;
  prefersCover?: boolean;
  onPointerEnter: (game: Game) => void;
  onPointerLeave: (game: Game) => void;
  onQuickPlay: (game: Game) => void;
  onTogglePin?: (game: Game) => void;
}

/** Props for the portaled context menu on right-clicked game rows. */
export interface SidebarContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  isPinned: boolean;
  onLaunch: () => void;
  onLaunchAdmin?: () => void;
  onViewDetails: () => void;
  onRemove: () => void;
  onTogglePin: () => void;
  onSetStatus: (status: PlayStatus) => void;
  onShowInFolder: () => void;
  onOpenStore: () => void;
  onCopyPath: () => void;
  onCopySteamId?: () => void;
  onRefreshMetadata?: () => void;
}

/** Props for the sticky floating bulk-actions bottom bar. */
export interface SidebarBulkActionBarProps {
  count: number;
  totalVisible: number;
  allPinned: boolean;
  allSelected: boolean;
  onSelectAll: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onSetStatus: (status: PlayStatus) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/** Props for the empty state representation. */
export interface SidebarEmptyStateProps {
  hasZeroLibraryGames: boolean;
  isFilteringActive: boolean;
  onImportClick: (e: React.MouseEvent<HTMLElement>) => void;
  onClearFilters: () => void;
}

/** Props for the import options dropdown menu. */
export interface SidebarImportDropdownProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onImportExe: () => void;
  onImportFolder: () => void;
}

/** Props for the interactive drag resize handle. */
export interface SidebarResizeHandleProps {
  isResizing: boolean;
  onStartResize: (e: React.MouseEvent) => void;
  onResetWidth: () => void;
}

/** Props for the bottom stats footer. */
export interface SidebarStatsFooterProps {
  stats: SidebarStats;
  isFilteringActive: boolean;
  onFilterInstalled: () => void;
}

/** Props for the alphabetical quick-jump scrubber rail. */
export interface SidebarAlphabetScrubberProps {
  availableLetters: string[];
  activeLetter?: string;
  onSelectLetter: (letter: string) => void;
}
