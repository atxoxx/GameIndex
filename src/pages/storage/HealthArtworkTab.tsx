import { useMemo, useState } from "react";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { OrphanArtwork } from "./health";
import { HealthEmptyState } from "./HealthEmptyState";

interface Props {
  orphans: OrphanArtwork[];
  onDelete: (relativePaths: string[]) => void;
}

export function HealthArtworkTab({ orphans, onDelete }: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  // Track deselection (not selection) so a fresh scan's new orphans start
  // checked without an effect syncing state.
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());

  const selected = useMemo(
    () => orphans.filter((o) => !deselected.has(o.relativePath)),
    [orphans, deselected]
  );
  const selectedBytes = useMemo(
    () => selected.reduce((sum, o) => sum + o.sizeBytes, 0),
    [selected]
  );

  if (orphans.length === 0) {
    return (
      <HealthEmptyState
        titleKey="storage.health.artwork.emptyTitle"
        descKey="storage.health.artwork.emptyDesc"
      />
    );
  }

  const toggle = (path: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allSelected = selected.length === orphans.length;

  return (
    <div className="health-tab">
      <div className="health-tab-toolbar">
        <button
          type="button"
          className="health-check-all"
          onClick={() => setDeselected(allSelected ? new Set(orphans.map((o) => o.relativePath)) : new Set())}
        >
          <span
            className={`health-check-box ${allSelected ? "health-check-box--on" : ""}`}
            aria-hidden="true"
          >
            {allSelected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span>{t("storage.health.artwork.selectAll")}</span>
        </button>
        <span className="health-tab-toolbar-text">
          {t("storage.health.artwork.reclaim", {
            size: formatSize(selectedBytes, unit),
          })}
        </span>
        <Button
          variant="danger"
          size="sm"
          disabled={selected.length === 0}
          onClick={() => onDelete(selected.map((o) => o.relativePath))}
        >
          {t("storage.health.artwork.delete", { count: selected.length })}
        </Button>
      </div>
      <ul className="health-issue-list">
        {orphans.map((orphan) => {
          const checked = !deselected.has(orphan.relativePath);
          return (
            <li key={orphan.relativePath} className="health-issue">
              <input
                type="checkbox"
                className="health-issue-check"
                checked={checked}
                onChange={() => toggle(orphan.relativePath)}
                aria-label={orphan.relativePath}
              />
              <div className="health-issue-body">
                <div className="health-issue-headline">
                  <span className="health-badge health-badge--warning">
                    {orphan.reason === "unreferencedGame"
                      ? t("storage.health.artwork.reasonGame")
                      : t("storage.health.artwork.reasonSlot")}
                  </span>
                  <span className="health-badge health-badge--muted">
                    {t("storage.health.artwork.slot", { slot: orphan.slot })}
                  </span>
                </div>
                <span className="health-issue-path" title={orphan.relativePath}>
                  {orphan.relativePath}
                </span>
              </div>
              <span className="health-issue-size">{formatSize(orphan.sizeBytes, unit)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
