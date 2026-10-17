import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import MultiSelectDropdown from "../ui/MultiSelectDropdown";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useShelves } from "../../context/ShelfContext";
import { filterGamesByShelf } from "../../hooks/shelfRules";
import { SORT_LABELS, SORT_OPTIONS, type LibrarySort } from "../../hooks/libraryFilters";
import { PLAY_STATUS_DETAILS, type LibrarySource, type PlayStatus } from "../../types/game";
import { ShelfIcon } from "./ShelfIcon";
import {
  countShelfRules,
  MAX_SHELVES,
  SHELF_COLORS,
  SHELF_ICONS,
  shelfDisplayName,
  type Shelf,
  type ShelfRules,
} from "../../types/shelf";

const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCE_OPTIONS: { value: LibrarySource; label?: string; labelKey?: string }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "steam", label: "Steam" },
  { value: "local", labelKey: "common.local" },
  { value: "gog", label: "GOG" },
  { value: "epic", label: "Epic" },
  { value: "humble", label: "Humble" },
  { value: "rockstar", label: "Rockstar" },
  { value: "ubisoft", label: "Ubisoft" },
  { value: "battlenet", label: "Battle.net" },
  { value: "ea", label: "EA" },
  { value: "xbox", label: "Xbox" },
  { value: "itch", label: "itch.io" },
];

export interface ShelfBuilderModalProps {
  open: boolean;
  /** The shelf being edited, or null when creating a new one. */
  shelf: Shelf | null;
  /** Rules to pre-fill when creating (e.g. from the current filters). */
  initialRules?: ShelfRules;
  onClose: () => void;
}

/** A labelled number input that writes `null` when cleared. */
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  unit,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="shelf-field">
      <span className="shelf-field__label">{label}</span>
      <span className="shelf-field__input-wrap">
        <input
          type="number"
          className="shelf-field__input"
          value={value ?? ""}
          min={min}
          step={step}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") onChange(null);
            else {
              const n = Number(raw);
              if (Number.isFinite(n)) onChange(n);
            }
          }}
        />
        {unit && <span className="shelf-field__unit">{unit}</span>}
      </span>
    </label>
  );
}

/** A labelled `<select>` row. */
function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="shelf-field">
      <span className="shelf-field__label">{label}</span>
      <select
        className="shelf-field__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="shelf-builder__section-title">{children}</div>;
}

function uniqSorted(values: (string[] | undefined)[]): string[] {
  const set = new Set<string>();
  for (const list of values) {
    if (!list) continue;
    for (const v of list) if (v && v.trim()) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function ShelfBuilderModal({ open, shelf, initialRules, onClose }: ShelfBuilderModalProps) {
  const { t } = useLanguage();
  const { games } = useGames();
  const { showToast } = useToast();
  const { createShelf, updateShelf, shelves, completedAtOf } = useShelves();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>("layers");
  const [color, setColor] = useState<string>("accent");
  const [sort, setSort] = useState<LibrarySort>("alphabetical");
  const [rules, setRules] = useState<ShelfRules>({});
  const [completedWithinDays, setCompletedWithinDays] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the modal opens for a different shelf.
  useEffect(() => {
    if (!open) return;
    if (shelf) {
      setName(shelfDisplayName(shelf.name, t));
      setIcon(shelf.icon);
      setColor(shelf.color);
      setSort(shelf.sort);
      setRules({ ...shelf.rules });
      setCompletedWithinDays(
        shelf.rules.completedFrom != null
          ? String(Math.max(0, Math.round((Date.now() - shelf.rules.completedFrom) / DAY_MS)))
          : ""
      );
    } else {
      setName("");
      setIcon("layers");
      setColor("accent");
      setSort("alphabetical");
      setRules({ ...(initialRules ?? {}) });
      setCompletedWithinDays("");
    }
    setSaving(false);
  }, [open, shelf, initialRules, t]);

  const availableGenres = useMemo(() => uniqSorted(games.map((g) => g.genres)), [games]);
  const availablePlatforms = useMemo(() => uniqSorted(games.map((g) => [g.platform])), [games]);
  const availableModes = useMemo(() => uniqSorted(games.map((g) => g.gameModes)), [games]);
  const availablePerspectives = useMemo(
    () => uniqSorted(games.map((g) => g.playerPerspectives)),
    [games]
  );

  // Fold the relative completion window back into the persisted rule.
  const effectiveRules = useMemo<ShelfRules>(() => {
    const days = completedWithinDays.trim() === "" ? null : Number(completedWithinDays);
    const next: ShelfRules = { ...rules };
    if (days != null && Number.isFinite(days) && days > 0) {
      next.completedFrom = Date.now() - days * DAY_MS;
    } else {
      delete next.completedFrom;
    }
    delete next.completedTo;
    return next;
  }, [rules, completedWithinDays]);

  const matchCount = useMemo(
    () => filterGamesByShelf(games, effectiveRules, completedAtOf).length,
    [games, effectiveRules, completedAtOf]
  );

  const duplicateName = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    return shelves.some(
      (s) => s.id !== (shelf?.id ?? "") && s.name.trim().toLowerCase() === trimmed
    );
  }, [name, shelves, shelf]);

  const ruleCount = countShelfRules(effectiveRules);

  if (!open) return null;

  const setGenres = (next: string[]) =>
    setRules((r) => ({ ...r, genres: next.length > 0 ? next : undefined }));
  const setPlatforms = (next: string[]) =>
    setRules((r) => ({ ...r, platforms: next.length > 0 ? next : undefined }));
  const setModes = (next: string[]) =>
    setRules((r) => ({ ...r, modes: next.length > 0 ? next : undefined }));
  const setPerspectives = (next: string[]) =>
    setRules((r) => ({ ...r, perspectives: next.length > 0 ? next : undefined }));

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast(t("shelves.builder.nameRequired"), "error");
      return;
    }
    setSaving(true);
    if (shelf) {
      await updateShelf({
        ...shelf,
        name: trimmed,
        icon,
        color,
        sort,
        rules: effectiveRules,
      });
      showToast(t("shelves.builder.updated", { name: trimmed }), "success");
    } else {
      const created = await createShelf({
        name: trimmed,
        icon,
        color,
        sort,
        rules: effectiveRules,
      });
      if (!created) {
        setSaving(false);
        showToast(t("shelves.limitReached", { max: MAX_SHELVES }), "error");
        return;
      }
      showToast(t("shelves.builder.created", { name: trimmed }), "success");
    }
    setSaving(false);
    onClose();
  };

  const body: ReactNode = (
    <div className="shelf-builder">
      <div className="shelf-builder__section-title">{t("shelves.builder.general")}</div>

      <div className="shelf-field">
        <span className="shelf-field__label">{t("shelves.builder.name")}</span>
        <input
          type="text"
          className="shelf-field__input"
          value={name}
          autoFocus
          placeholder={t("shelves.builder.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave();
          }}
        />
        {duplicateName && (
          <span className="shelf-field__warn">{t("shelves.builder.duplicateName")}</span>
        )}
      </div>

      <div className="shelf-grid-2">
        <div className="shelf-field shelf-field--block">
          <span className="shelf-field__label">{t("shelves.builder.icon")}</span>
          <div className="shelf-icon-picker">
            {SHELF_ICONS.map((iconName) => (
              <button
                key={iconName}
                type="button"
                className={"shelf-icon-option" + (icon === iconName ? " shelf-icon-option--active" : "")}
                onClick={() => setIcon(iconName)}
                aria-label={iconName}
              >
                <ShelfIcon name={iconName} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="shelf-field shelf-field--block">
          <span className="shelf-field__label">{t("shelves.builder.color")}</span>
          <div className="shelf-color-picker">
            {SHELF_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={"shelf-color-option" + (color === c ? " shelf-color-option--active" : "")}
                style={{ ["--shelf-swatch" as string]: `var(--color-${c})` }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      </div>

      <SectionTitle>{t("shelves.builder.rules")}</SectionTitle>

      <div className="shelf-grid-2">
        <SelectField label={t("sidebarFilter.sort")} value={sort} onChange={(v) => setSort(v as LibrarySort)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option]}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={t("sidebarFilter.status")}
          value={rules.status ?? "all"}
          onChange={(v) =>
            setRules((r) => ({
              ...r,
              status: v === "all" ? undefined : (v as ShelfRules["status"]),
            }))
          }
        >
          <option value="all">{t("sidebarFilter.statusAll")}</option>
          <option value="installed">{t("sidebarFilter.statusInstalled")}</option>
          <option value="not_installed">{t("sidebarFilter.statusUninstalled")}</option>
        </SelectField>

        <SelectField
          label={t("edit.label.playStatus")}
          value={rules.playStatus ?? "all"}
          onChange={(v) =>
            setRules((r) => ({
              ...r,
              playStatus: v === "all" ? undefined : (v as PlayStatus),
            }))
          }
        >
          <option value="all">{t("sidebarFilter.statusAll")}</option>
          {(Object.keys(PLAY_STATUS_DETAILS) as PlayStatus[]).map((status) => (
            <option key={status} value={status}>
              {t(PLAY_STATUS_DETAILS[status].labelKey)}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={t("shelves.rule.source")}
          value={rules.sources?.[0] ?? "all"}
          onChange={(v) =>
            setRules((r) => ({
              ...r,
              sources: v === "all" ? undefined : [v as LibrarySource],
            }))
          }
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelKey ? t(o.labelKey) : o.label}
            </option>
          ))}
        </SelectField>

        <div className="shelf-field">
          <span className="shelf-field__label">{t("sidebarFilter.genres")}</span>
          <MultiSelectDropdown
            label={t("sidebarFilter.genres")}
            placeholder={t("common.all")}
            options={availableGenres}
            selected={rules.genres ?? []}
            onChange={setGenres}
            clearLabel={t("common.clear")}
            searchPlaceholder={t("store.filters.searchGenres")}
            noResultsLabel={t("common.noResults")}
          />
        </div>

        <div className="shelf-field">
          <span className="shelf-field__label">{t("sidebarFilter.platforms")}</span>
          <MultiSelectDropdown
            label={t("sidebarFilter.platforms")}
            placeholder={t("common.all")}
            options={availablePlatforms}
            selected={rules.platforms ?? []}
            onChange={setPlatforms}
            clearLabel={t("common.clear")}
            searchPlaceholder={t("store.filters.searchPlatforms")}
            noResultsLabel={t("common.noResults")}
          />
        </div>

        <div className="shelf-field">
          <span className="shelf-field__label">{t("shelves.rule.modes")}</span>
          <MultiSelectDropdown
            label={t("shelves.rule.modes")}
            placeholder={t("common.all")}
            options={availableModes}
            selected={rules.modes ?? []}
            onChange={setModes}
            clearLabel={t("common.clear")}
            noResultsLabel={t("common.noResults")}
          />
        </div>

        <div className="shelf-field">
          <span className="shelf-field__label">{t("shelves.rule.perspectives")}</span>
          <MultiSelectDropdown
            label={t("shelves.rule.perspectives")}
            placeholder={t("common.all")}
            options={availablePerspectives}
            selected={rules.perspectives ?? []}
            onChange={setPerspectives}
            clearLabel={t("common.clear")}
            noResultsLabel={t("common.noResults")}
          />
        </div>
      </div>

      <SectionTitle>{t("shelves.builder.limits")}</SectionTitle>

      <div className="shelf-grid-2">
        <NumberField
          label={t("shelves.rule.yearMin")}
          value={rules.yearMin}
          onChange={(v) => setRules((r) => ({ ...r, yearMin: v }))}
        />
        <NumberField
          label={t("shelves.rule.yearMax")}
          value={rules.yearMax}
          onChange={(v) => setRules((r) => ({ ...r, yearMax: v }))}
        />
        <NumberField
          label={t("sidebarFilter.minRating")}
          value={rules.ratingMin}
          onChange={(v) => setRules((r) => ({ ...r, ratingMin: v }))}
          min={0}
        />
        <NumberField
          label={t("shelves.rule.storyMax")}
          value={rules.storyMaxHours}
          onChange={(v) => setRules((r) => ({ ...r, storyMaxHours: v }))}
          unit="h"
        />
        <NumberField
          label={t("shelves.rule.playtimeMin")}
          value={rules.playtimeMinHours}
          onChange={(v) => setRules((r) => ({ ...r, playtimeMinHours: v }))}
          unit="h"
        />
        <NumberField
          label={t("shelves.rule.playtimeMax")}
          value={rules.playtimeMaxHours}
          onChange={(v) => setRules((r) => ({ ...r, playtimeMaxHours: v }))}
          unit="h"
        />
        <NumberField
          label={t("shelves.rule.lastPlayedWithin")}
          value={rules.lastPlayedWithinDays}
          onChange={(v) => setRules((r) => ({ ...r, lastPlayedWithinDays: v }))}
          unit={t("shelves.rule.days")}
        />
        <NumberField
          label={t("shelves.rule.addedWithin")}
          value={rules.addedWithinDays}
          onChange={(v) => setRules((r) => ({ ...r, addedWithinDays: v }))}
          unit={t("shelves.rule.days")}
        />
        <NumberField
          label={t("shelves.rule.completedWithin")}
          value={completedWithinDays.trim() === "" ? null : Number(completedWithinDays)}
          onChange={(v) => setCompletedWithinDays(v == null ? "" : String(v))}
          unit={t("shelves.rule.days")}
        />
      </div>

      <label className="shelf-checkbox">
        <input
          type="checkbox"
          checked={!!rules.vrOnly}
          onChange={(e) => setRules((r) => ({ ...r, vrOnly: e.target.checked || undefined }))}
        />
        <span>{t("library.filter.vrOnly")}</span>
      </label>
    </div>
  );

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="modal shelf-builder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shelf-builder-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span
            className="modal-header-icon"
            style={{ ["--shelf-swatch" as string]: `var(--color-${color})` }}
          >
            <ShelfIcon name={icon} size={20} />
          </span>
          <div className="modal-header-text">
            <h2 className="modal-title" id="shelf-builder-title">
              {shelf ? t("shelves.builder.editTitle") : t("shelves.builder.createTitle")}
            </h2>
            <span className="modal-subtitle">
              {ruleCount === 0
                ? t("shelves.builder.noRules")
                : t("shelves.builder.matchCount", { count: matchCount })}
            </span>
          </div>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<X size={18} />}
            type="button"
            
            onClick={onClose}
            aria-label={t("common.close")}
          ></Button>
        </div>

        <div className="modal-body shelf-builder__body">{body}</div>

        <div className="modal-footer">
          <span className="shelf-builder__preview">
            {ruleCount > 0 && (
              <>
                <ShelfIcon name={icon} size={14} />
                <strong>{matchCount}</strong>&nbsp;{t("shelves.builder.games")}
              </>
            )}
          </span>
          <div className="modal-footer-actions">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
              {shelf ? t("shelves.builder.save") : t("shelves.builder.create")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ShelfBuilderModal;
