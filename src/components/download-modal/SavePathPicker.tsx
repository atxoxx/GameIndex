import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Save-path selector card.
 * Clearly displays the target download directory, the automatically created
 * game subfolder, and provides a prominent folder change action.
 */
export function SavePathPicker({
  savePath,
  gameName,
  onPickPath,
}: {
  savePath: string | null;
  gameName: string;
  onPickPath: () => void;
}) {
  const { t } = useLanguage();
  const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
  const normalizedPath = savePath ? savePath.replace(/\\/g, "/") : null;
  const alreadyHasSubfolder = normalizedPath?.endsWith(`/${safeGameFolder}`);
  const finalDisplayPath = savePath
    ? alreadyHasSubfolder
      ? savePath
      : `${savePath}\\${safeGameFolder}`
    : null;

  return (
    <div className="dl-save-path-card">
      <div className="dl-save-path-icon-col">
        <div className="dl-save-path-badge">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
      </div>

      <div className="dl-save-path-info">
        <div className="dl-save-path-main">
          <span
            className={`dl-save-path-text${savePath ? "" : " placeholder"}`}
            title={finalDisplayPath ?? ""}
          >
            {finalDisplayPath ?? t("downloadModal.noFolderSelected")}
          </span>
        </div>
        {savePath && (
          <div className="dl-save-path-hint-row">
            <span className="dl-save-path-subfolder-pill">
              📁 {safeGameFolder}
            </span>
            <span className="dl-save-path-hint-text">
              {t("downloadModal.saveLocationHint")}
            </span>
          </div>
        )}
      </div>

      <div className="dl-save-path-action">
        <Button variant="secondary" size="sm" onClick={onPickPath}>
          {savePath ? t("downloadModal.changeFolder") : t("downloadModal.chooseFolder")}
        </Button>
      </div>
    </div>
  );
}

