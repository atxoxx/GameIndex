// Left rail of the Emulators workbench. Systems, not menus: every row carries
// the emulator's own mark, its platform and how many ROMs it owns, and the
// selected row paints its brand accent into the card edge.

import { useCallback, useMemo, type KeyboardEvent } from "react";
import { Pencil, Plus, Search, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import type { Emulator } from "../../types/emulator";
import {
  emulatorVisual,
  isEmulatorReady,
  matchesStatusFilter,
  type EmuStatusFilter,
} from "./emulatorUi";

interface SystemsRailProps {
  emulators: Emulator[];
  romCounts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: EmuStatusFilter;
  onStatusFilterChange: (filter: EmuStatusFilter) => void;
  onAddEmulator: () => void;
  onEdit: (emulator: Emulator) => void;
}

export default function EmulatorSystemsRail({
  emulators,
  romCounts,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onAddEmulator,
  onEdit,
}: SystemsRailProps) {
  const { t } = useLanguage();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = emulators.filter((emu) => {
      if (q && !emu.name.toLowerCase().includes(q) && !emu.platform.toLowerCase().includes(q)) {
        return false;
      }
      return matchesStatusFilter(emu, statusFilter);
    });
    return [...base].sort((a, b) => {
      const readyDelta = Number(isEmulatorReady(b)) - Number(isEmulatorReady(a));
      if (readyDelta !== 0) return readyDelta;
      return a.name.localeCompare(b.name);
    });
  }, [emulators, search, statusFilter]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const ids = rows.map((emu) => emu.id);
      if (ids.length === 0) return;
      const current = selectedId ?? ids[0];
      const index = ids.indexOf(current);
      let next = index;
      if (e.key === "ArrowDown") next = Math.min(ids.length - 1, index + 1);
      else if (e.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (e.key === "Home") next = 0;
      else next = ids.length - 1;
      if (next !== index) {
        e.preventDefault();
        onSelect(ids[next]);
      }
    },
    [rows, selectedId, onSelect]
  );

  const filters: { key: EmuStatusFilter; label: string }[] = [
    { key: "all", label: t("emulators.filter.all") },
    { key: "ready", label: t("emulators.status.configured") },
    { key: "needsSetup", label: t("emulators.status.notConfigured") },
  ];

  return (
    <aside className="emu-wb-rail" aria-label={t("emulators.list.title")}>
      <header className="emu-wb-rail-head">
        <span className="emu-wb-rail-title">
          {t("emulators.list.title")}
          <span className="emu-wb-rail-count">{rows.length}</span>
        </span>
        <button
          type="button"
          className="emu-wb-rail-add"
          onClick={onAddEmulator}
          title={t("emulators.addEmulator")}
          aria-label={t("emulators.addEmulator")}
        >
          <Plus size={15} />
        </button>
      </header>

      <div className="emu-wb-search">
        <Search size={14} className="emu-wb-search-icon" aria-hidden />
        <input
          type="search"
          value={search}
          placeholder={t("emulators.list.search")}
          aria-label={t("emulators.list.search")}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="emu-wb-search-clear"
            onClick={() => onSearchChange("")}
            aria-label={t("emulators.list.clearSearch")}
          >
            <X size={13} aria-hidden />
          </button>
        )}
      </div>

      <div className="emu-wb-filters" role="tablist" aria-label={t("emulators.filter.label")}>
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            role="tab"
            aria-selected={statusFilter === filter.key}
            className={`emu-wb-filter${statusFilter === filter.key ? " is-active" : ""}`}
            onClick={() => onStatusFilterChange(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div
        className="emu-wb-systems"
        role="listbox"
        tabIndex={0}
        aria-label={t("emulators.list.title")}
        onKeyDown={onKeyDown}
      >
        {emulators.length === 0 ? (
          <div className="emu-wb-rail-empty">
            <span aria-hidden>🕹️</span>
            <strong>{t("emulators.empty.title")}</strong>
            <p>{t("emulators.empty.desc")}</p>
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={onAddEmulator}>
              {t("emulators.empty.cta")}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="emu-wb-rail-empty">
            <span aria-hidden>🔍</span>
            <p>{t("emulators.list.empty")}</p>
          </div>
        ) : (
          rows.map((emu) => {
            const visual = emulatorVisual(emu);
            const ready = isEmulatorReady(emu);
            const count = romCounts[emu.id] ?? 0;
            const active = emu.id === selectedId;
            return (
              <div
                key={emu.id}
                className={`emu-wb-system${active ? " is-active" : ""}`}
                style={{ ["--emu-accent" as string]: visual.accent }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  className="emu-wb-system-main"
                  onClick={() => onSelect(emu.id)}
                  onDoubleClick={() => onEdit(emu)}
                >
                  <span className="emu-wb-system-art" aria-hidden>
                    {visual.logo ? (
                      <img src={visual.logo} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span>{visual.glyph}</span>
                    )}
                  </span>
                  <span className="emu-wb-system-text">
                    <span className="emu-wb-system-name">{emu.name}</span>
                    <span className="emu-wb-system-sub">
                      {emu.platform}
                      {count > 0 && <span className="emu-wb-system-count"> · {count}</span>}
                    </span>
                  </span>
                  <span
                    className={`emu-wb-system-state${ready ? " is-ready" : ""}`}
                    title={ready ? t("emulators.status.configured") : t("emulators.status.notConfigured")}
                  />
                </button>
                <button
                  type="button"
                  className="emu-wb-system-edit"
                  title={t("emulators.edit")}
                  aria-label={`${t("emulators.edit")} ${emu.name}`}
                  onClick={() => onEdit(emu)}
                >
                  <Pencil size={13} aria-hidden />
                </button>
              </div>
            );
          })
        )}
      </div>

      <footer className="emu-wb-rail-foot">
        <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={onAddEmulator}>
          {t("emulators.addEmulator")}
        </Button>
      </footer>
    </aside>
  );
}
