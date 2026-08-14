import { useLanguage } from "../../context/LanguageContext";
import { formatBytesShort } from "../../types/download";
import { Button } from "../ui";

interface BulkBarProps {
  selectedCount: number;
  totalBytes: number;
  onLaunch: () => void;
  onOpenLocations: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export default function EmulatorRomBulkBar({
  selectedCount,
  totalBytes,
  onLaunch,
  onOpenLocations,
  onDelete,
  onClear,
}: BulkBarProps) {
  const { t } = useLanguage();

  if (selectedCount === 0) return null;

  return (
    <div className="emu-games-bulkbar" role="toolbar" aria-label="Bulk actions">
      <div className="emu-games-bulk-info">
        <span className="emu-games-bulkcount">
          {t("emulators.games.selected", { count: selectedCount })}
        </span>
        {totalBytes > 0 && (
          <span className="emu-games-bulksize">({formatBytesShort(totalBytes)})</span>
        )}
      </div>

      <div className="emu-games-bulk-buttons">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={
            <svg {...ICON}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          }
          onClick={onLaunch}
        >
          {t("emulators.games.launch")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={
            <svg {...ICON}>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          }
          onClick={onOpenLocations}
        >
          {t("emulators.games.openLocation")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          leftIcon={
            <svg {...ICON}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          }
          onClick={onDelete}
        >
          {t("emulators.games.deleteRom")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
