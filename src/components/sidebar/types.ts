import type { Game, PlayStatus } from "../../types/game";
import type { LibraryStatus } from "../../hooks/useLibraryFilters";

/** Collapsed sections dictionary (e.g. pinned: true, recent: false). */
export type SectionCollapseMap = Record<string, boolean>;

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
  showImportMenu: boolean;
  importMenuAnchor: HTMLElement | null;
  onToggleImportMenu: (anchor: HTMLElement) => void;
  onImportExe: () => void;
  onImportFolder: () => void;
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

/** Props for collapsible section headers (Pinned, Recently Played, All Games). */
export interface SidebarSectionHeaderProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  resultLabel?: string;
}

/** Props for a single memoized row in the sidebar game list. */
export interface SidebarGameItemProps {
  game: Game;
  isSelected: boolean;
  isRunning: boolean;
  bulkSelected: boolean;
  searchQuery: string;
  prefersCover?: boolean;
  onPointerEnter: (game: Game) => void;
  onPointerLeave: (game: Game) => void;
  onQuickPlay: (game: Game) => void;
}

/** Props for the portaled context menu on right-clicked game rows. */
export interface SidebarContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  isPinned: boolean;
  onLaunch: () => void;
  onViewDetails: () => void;
  onRemove: () => void;
  onTogglePin: () => void;
  onSetStatus: (status: PlayStatus) => void;
  onShowInFolder: () => void;
  onOpenStore: () => void;
  onCopyPath: () => void;
}

/** Props for the sticky floating bulk-actions bottom bar. */
export interface SidebarBulkActionBarProps {
  count: number;
  allPinned: boolean;
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
