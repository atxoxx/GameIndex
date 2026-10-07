import { useCallback, useMemo, memo, type KeyboardEvent } from "react";
import { Plus, Search, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import type { Emulator } from "../../types/emulator";
import {
  emulatorVisual,
  isEmulatorReady,
  matchesStatusFilter,
  type EmulatorVisual,
  type EmuStatusFilter,
} from "./emulatorUi";

interface SidebarProps {
  emulators: Emulator[];
  romCounts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: EmuStatusFilter;
  onStatusFilterChange: (filter: EmuStatusFilter) => void;
  onAddEmulator: () => void;
}

function RowGlyph({ visual }: { visual: EmulatorVisual }) {
  if (visual.logo) {
    return (
      <img
        className="emu-row-glyph-img"
        src={visual.logo}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <span className="emu-row-glyph">{visual.glyph}</span>;
}

function EmulatorSidebarListBase({
  emulators,
  romCounts,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onAddEmulator,
}: SidebarProps) {
  const { t } = useLanguage();

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = emulators.filter((emu) => {
      if (
        q &&
        !emu.name.toLowerCase().includes(q) &&
        !emu.platform.toLowerCase().includes(q)
      ) {
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

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      )
        return;
      const ids = filteredRows.map((emu) => emu.id);
      if (ids.length === 0) return;
      const current = selectedId ?? ids[0];
      const idx = ids.indexOf(current);
      let next = idx;
      if (e.key === "ArrowDown") next = Math.min(ids.length - 1, idx + 1);
      else if (e.key === "ArrowUp") next = Math.max(0, idx - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ids.length - 1;
      if (next !== idx) {
        e.preventDefault();
        onSelect(ids[next]);
      }
    },
    [filteredRows, selectedId, onSelect]
  );

  const statusFilters: { key: EmuStatusFilter; label: string }[] = [
    { key: "all", label: t("emulators.filter.all") },
    { key: "ready", label: t("emulators.status.configured") },
    { key: "needsSetup", label: t("emulators.status.notConfigured") },
  ];

  return (
    <aside className="emulators-list-pane">
      <div className="emulators-list-pane-header">
        <span className="emulators-list-pane-title">
          {t("emulators.list.title")}
        </span>
        <span className="emulators-list-pane-count">
          {filteredRows.length} / {emulators.length}
        </span>
      </div>

      <div className="emulators-search-wrap">
        <Search className="emulators-search-icon" aria-hidden />
        <input
          className="emulators-search"
          type="text"
          placeholder={t("emulators.list.search")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button
            className="emulators-search-clear"
            type="button"
            aria-label={t("emulators.list.clearSearch")}
            onClick={() => onSearchChange("")}
          >
            <X aria-hidden />
          </button>
        )}
      </div>

      <div className="emu-status-chips">
        {statusFilters.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`emu-status-chip${
              statusFilter === s.key ? " is-active" : ""
            }`}
            aria-pressed={statusFilter === s.key}
            onClick={() => onStatusFilterChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        className="emulators-list"
        role="listbox"
        tabIndex={0}
        aria-label={t("emulators.list.title")}
        onKeyDown={handleListKeyDown}
      >
        {emulators.length === 0 ? (
          <div className="emulators-list-empty">
            <span className="emulators-list-empty-glyph" aria-hidden>
              🕹️
            </span>
            <strong>{t("emulators.empty.title")}</strong>
            <span>{t("emulators.empty.desc")}</span>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus aria-hidden />}
              onClick={onAddEmulator}
            >
              {t("emulators.empty.cta")}
            </Button>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="emulators-list-empty">
            <span className="emulators-list-empty-glyph" aria-hidden>
              🔍
            </span>
            <span>{t("emulators.list.empty")}</span>
          </div>
        ) : (
          filteredRows.map((emu) => {
            const active = selectedId === emu.id;
            const visual = emulatorVisual(emu);
            const ready = isEmulatorReady(emu);
            const count = romCounts[emu.id] ?? 0;
            return (
              <button
                key={emu.id}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                className={`emu-row${active ? " is-active" : ""}`}
                style={{ ["--emu-accent" as string]: visual.accent }}
                onClick={() => onSelect(emu.id)}
              >
                <RowGlyph visual={visual} />
                <span className="emu-row-main">
                  <span className="emu-row-name">{emu.name}</span>
                  <span className="emu-row-platform">{emu.platform}</span>
                </span>
                <span className="emu-row-meta">
                  <span className="emu-row-count">
                    {count === 1
                      ? t("emulators.romCountSingle", { count })
                      : t("emulators.romCount", { count })}
                  </span>
                  <span
                    className={`emu-status-dot ${
                      ready ? "is-ready" : "is-needs-setup"
                    }`}
                    title={
                      ready
                        ? t("emulators.status.configured")
                        : t("emulators.status.notConfigured")
                    }
                    aria-label={
                      ready
                        ? t("emulators.status.configured")
                        : t("emulators.status.notConfigured")
                    }
                  />
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="emu-sidebar-footer">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus aria-hidden />}
          onClick={onAddEmulator}
        >
          {t("emulators.addEmulator")}
        </Button>
      </div>
    </aside>
  );
}

export default memo(EmulatorSidebarListBase);
