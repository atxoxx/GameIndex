import { useCallback, useMemo, useState } from "react";
import { GripVertical, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { ConfirmModal } from "../ui/ConfirmModal";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useShelves } from "../../context/ShelfContext";
import { useLibraryFilterState } from "../../context/LibraryFilterContext";
import { rulesFromFilters, shelfRulesToFilters } from "../../hooks/shelfRules";
import { useCollapsedState } from "../../hooks/useCollapsedState";
import { useOrderDrag } from "../../pages/settings/useOrderDrag";
import { MAX_SHELVES, shelfDisplayName, type Shelf } from "../../types/shelf";
import { ShelfIcon } from "./ShelfIcon";
import { ShelfBuilderModal } from "./ShelfBuilderModal";

export interface SidebarShelvesProps {
  /** Hidden entirely while the sidebar is collapsed to the icon rail. */
  isIconRail: boolean;
}

/**
 * SidebarShelves — the "Shelves" section of the app sidebar.
 *
 * Lists every shelf in drag order with its live match count. Clicking a
 * row applies that shelf as the Library filter (facets + sort from its
 * rules); clicking the active row clears it. Each row also exposes
 * pin-to-Home, edit and delete, and the section header creates a shelf
 * (from scratch or from the filters currently in effect).
 */
export function SidebarShelves({ isIconRail }: SidebarShelvesProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    shelves,
    activeShelfId,
    enabled,
    setActiveShelf,
    shelfCount,
    deleteShelf,
    reorderShelves,
    updateShelf,
  } = useShelves();
  const { filters, reset, setSearch, setGenres, setPlatforms, setYearRange, setRatingMin, setStatus, setSource, setPlayStatus, setVrOnly, setSort } =
    useLibraryFilterState();

  // Persisted so the user's choice survives a relaunch; defaults to
  // collapsed so the sidebar stays compact on first launch. When there
  // are no shelves the section stays expanded to show the empty state.
  const [collapsed, toggleCollapsed] = useCollapsedState(
    "gamelib:sidebar:shelves:collapsed:v1",
    shelves.length > 0,
    true
  );
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Shelf | null>(null);
  const [initialRules, setInitialRules] = useState<Shelf["rules"] | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Shelf | null>(null);

  const ordered = useMemo(
    () => [...shelves].sort((a, b) => a.position - b.position),
    [shelves]
  );

  const handleReorder = useCallback(
    (from: number, to: number) => {
      const ids = ordered.map((s) => s.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      void reorderShelves(ids);
    },
    [ordered, reorderShelves]
  );

  const { containerRef, dragIndex, overIndex, startDrag, movedRef } = useOrderDrag(handleReorder);

  const applyShelf = useCallback(
    (shelf: Shelf) => {
      const partial = shelfRulesToFilters(shelf.rules);
      reset();
      setSearch(shelf.rules.search ?? "");
      if (partial.genres) setGenres(partial.genres);
      if (partial.platforms) setPlatforms(partial.platforms);
      if (partial.yearMin != null || partial.yearMax != null) {
        setYearRange(partial.yearMin ?? null, partial.yearMax ?? null);
      }
      if (partial.ratingMin != null) setRatingMin(partial.ratingMin);
      if (partial.status) setStatus(partial.status);
      if (partial.source) setSource(partial.source);
      if (partial.playStatus) setPlayStatus(partial.playStatus);
      if (partial.vrOnly) setVrOnly(true);
      setSort(shelf.sort);
      setActiveShelf(shelf.id);
    },
    [
      reset,
      setSearch,
      setGenres,
      setPlatforms,
      setYearRange,
      setRatingMin,
      setStatus,
      setSource,
      setPlayStatus,
      setVrOnly,
      setSort,
      setActiveShelf,
    ]
  );

  const handleRowActivate = useCallback(
    (shelf: Shelf) => {
      if (activeShelfId === shelf.id) {
        reset();
        setActiveShelf(null);
        return;
      }
      applyShelf(shelf);
    },
    [activeShelfId, applyShelf, reset, setActiveShelf]
  );

  const openCreate = useCallback(
    (fromFilters: boolean) => {
      if (shelves.length >= MAX_SHELVES) {
        showToast(t("shelves.limitReached", { max: MAX_SHELVES }), "error");
        return;
      }
      setEditing(null);
      setInitialRules(fromFilters ? rulesFromFilters(filters) : undefined);
      setBuilderOpen(true);
    },
    [shelves.length, showToast, t, filters]
  );

  const handleTogglePin = useCallback(
    (shelf: Shelf) => {
      void updateShelf({ ...shelf, pinned: !shelf.pinned });
    },
    [updateShelf]
  );

  if (isIconRail || !enabled) return null;

  return (
    <div className="sidebar-shelves">
      <div className="sidebar-section-header sidebar-section-header--collapsible">
        <button
          type="button"
          className="sidebar-section-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
        >
          <span className="sidebar-section-toggle__chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform var(--transition-fast)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <span className="sidebar-section-title-group">
            <span className="sidebar-section-title-text">{t("shelves.title")}</span>
          </span>
        </button>
        <div className="sidebar-shelves__actions">
          <button
            type="button"
            className="sidebar-shelves__action"
            title={t("shelves.createFromFilters")}
            onClick={() => openCreate(true)}
          >
            <Plus size={14} />
          </button>
          <span className="sidebar-list-count">{ordered.length}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="sidebar-shelves__list" ref={containerRef}>
          {ordered.length === 0 ? (
            <p className="sidebar-shelves__empty">{t("shelves.empty")}</p>
          ) : (
            ordered.map((shelf, index) => {
              const isActive = activeShelfId === shelf.id;
              return (
                <div
                  key={shelf.id}
                  data-order-index={index}
                  className={
                    "shelf-row" +
                    (isActive ? " shelf-row--active" : "") +
                    (dragIndex === index ? " shelf-row--dragging" : "") +
                    (overIndex === index && dragIndex !== index ? " shelf-row--over" : "")
                  }
                  style={{ ["--shelf-swatch" as string]: `var(--color-${shelf.color})` }}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("[data-shelf-action]")) return;
                    startDrag(index, { x: e.clientX, y: e.clientY });
                  }}
                  onClick={() => {
                    if (movedRef.current) return;
                    handleRowActivate(shelf);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowActivate(shelf);
                    }
                  }}
                >
                  <span className="shelf-row__grip" aria-hidden="true">
                    <GripVertical size={13} />
                  </span>
                  <span className="shelf-row__icon">
                    <ShelfIcon name={shelf.icon} size={15} />
                  </span>
                  <span className="shelf-row__name">{shelfDisplayName(shelf.name, t)}</span>
                  <span className="shelf-row__count">{shelfCount(shelf.id)}</span>
                  <span className="shelf-row__actions">
                    <button
                      type="button"
                      data-shelf-action
                      className="shelf-row__action"
                      title={shelf.pinned ? t("shelves.unpin") : t("shelves.pin")}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(shelf);
                      }}
                    >
                      {shelf.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button
                      type="button"
                      data-shelf-action
                      className="shelf-row__action"
                      title={t("shelves.edit")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(shelf);
                        setInitialRules(undefined);
                        setBuilderOpen(true);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      data-shelf-action
                      className="shelf-row__action shelf-row__action--danger"
                      title={t("shelves.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(shelf);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {builderOpen && (
        <ShelfBuilderModal
          open={builderOpen}
          shelf={editing}
          initialRules={initialRules}
          onClose={() => {
            setBuilderOpen(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("shelves.delete")}
        message={
          pendingDelete
            ? t("shelves.deleteConfirm", { name: shelfDisplayName(pendingDelete.name, t) })
            : undefined
        }
        confirmLabel={t("shelves.delete")}
        onConfirm={() => {
          if (pendingDelete) {
            void deleteShelf(pendingDelete.id);
            showToast(t("shelves.deleted", { name: shelfDisplayName(pendingDelete.name, t) }), "info");
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <div className="sidebar-shelves__new">
        <Button variant="ghost" size="sm" onClick={() => openCreate(false)}>
          <Plus size={14} />
          {t("shelves.create")}
        </Button>
      </div>
    </div>
  );
}

export default SidebarShelves;
