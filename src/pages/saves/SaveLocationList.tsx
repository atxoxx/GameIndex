import { Check, FileText, FolderOpen, TriangleAlert, Trash2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { SaveLocation } from "../../types/saves";
import { LocationSourceBadge } from "./SavesBadges";

interface SaveLocationListProps {
  locations: SaveLocation[];
  /** `false` means the path is gone; missing entries are simply unknown. */
  health: ReadonlyMap<string, boolean>;
  onToggle: (location: SaveLocation) => void;
  onOpen: (location: SaveLocation) => void;
  onRemove: (location: SaveLocation) => void;
  busyId?: string | null;
}

/**
 * The canonical save-location row list, shared by the hub's detail pane and
 * the per-game Saves tab.
 *
 * Include/exclude lives on the checkbox (backups only capture included
 * locations); the row itself opens the folder and carries the two mutations.
 */
export default function SaveLocationList({
  locations,
  health,
  onToggle,
  onOpen,
  onRemove,
  busyId,
}: SaveLocationListProps) {
  const { t } = useLanguage();

  if (locations.length === 0) return null;

  return (
    <ul className="saves-locations">
      {locations.map((location) => {
        const missing = health.get(location.id) === false;
        const busy = busyId === location.id;
        return (
          <li
            key={location.id}
            className={[
              "saves-location",
              location.include ? "" : "is-excluded",
              missing ? "is-missing" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <label className="saves-location__toggle" title={t("saves.locations.include")}>
              <input
                type="checkbox"
                checked={location.include}
                onChange={() => onToggle(location)}
                disabled={busy}
                aria-label={t("saves.locations.include")}
              />
              <span className="saves-location__check" aria-hidden="true">
                <Check size={11} />
              </span>
            </label>

            <div className="saves-location__body">
              <div className="saves-location__top">
                <span className="saves-location__label">
                  {location.label || t("saves.locations.untitled")}
                </span>
                <LocationSourceBadge source={location.source} />
                <span className="saves-location__kind">
                  {location.kind === "file" ? (
                    <FileText size={12} aria-hidden="true" />
                  ) : (
                    <FolderOpen size={12} aria-hidden="true" />
                  )}
                  {location.kind === "file"
                    ? t("saves.locations.kindFile")
                    : t("saves.locations.kindFolder")}
                </span>
                {missing && (
                  <span className="saves-location__missing" title={t("saves.locations.missingHint")}>
                    <TriangleAlert size={12} aria-hidden="true" />
                    {t("saves.locations.missing")}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="saves-location__path"
                onClick={() => onOpen(location)}
                title={t("saves.action.openFolder")}
              >
                {location.path}
              </button>
            </div>

            <div className="saves-location__actions">
              <button
                type="button"
                className="saves-icon-btn"
                onClick={() => onOpen(location)}
                title={t("saves.action.openFolder")}
                aria-label={t("saves.action.openFolder")}
              >
                <FolderOpen size={15} />
              </button>
              <button
                type="button"
                className="saves-icon-btn saves-icon-btn--danger"
                onClick={() => onRemove(location)}
                disabled={busy}
                title={t("saves.action.removeLocation")}
                aria-label={t("saves.action.removeLocation")}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
