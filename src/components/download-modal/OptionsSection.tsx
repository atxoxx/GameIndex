import { useLanguage } from "../../context/LanguageContext";
import type { CacheCheckStatus } from "./types";

/**
 * Modern Download Options section.
 * Renders interactive toggle cards with distinct icons, titles, and
 * descriptive helper subtitles.
 */
export function OptionsSection({
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
  isDirect,
  useDebrid,
  onUseDebrid,
  debridAvailable,
  cacheStatus,
}: {
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  isDirect: boolean;
  useDebrid: boolean;
  onUseDebrid: (v: boolean) => void;
  debridAvailable: boolean;
  cacheStatus: CacheCheckStatus;
}) {
  const { t } = useLanguage();
  // Debrid downloads the whole file, so per-file selection only makes sense on plain P2P
  const showChooseFiles = !isDirect && !(useDebrid && debridAvailable);

  return (
    <div className="dl-options-cards">
      {/* Auto-Extract Option */}
      <label className={`dl-option-card${autoExtract ? " is-active" : ""}`}>
        <div className="dl-option-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </div>
        <div className="dl-option-text">
          <span className="dl-option-heading">{t("downloadModal.autoExtract")}</span>
          <span className="dl-option-subtext">{t("downloadModal.autoExtractDesc")}</span>
        </div>
        <span className="dl-switch-toggle">
          <input
            type="checkbox"
            checked={autoExtract}
            onChange={(e) => onAutoExtract(e.target.checked)}
          />
          <span className="dl-switch-slider" aria-hidden />
        </span>
      </label>

      {/* Debrid Option */}
      {debridAvailable && (
        <label className={`dl-option-card dl-option-card--debrid${useDebrid ? " is-active" : ""}`}>
          <div className="dl-option-icon dl-option-icon--debrid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div className="dl-option-text">
            <div className="dl-option-title-row">
              <span className="dl-option-heading">{t("downloadModal.useDebrid")}</span>
              {useDebrid && cacheStatus !== "idle" && (
                <span className={`dl-cache-badge dl-cache-badge--${cacheStatus}`}>
                  {cacheStatus === "checking" && <span className="dl-cache-spinner" aria-hidden />}
                  {cacheStatus === "cached" && "⚡ "}
                  {cacheStatus === "checking"
                    ? t("downloadModal.cacheChecking")
                    : cacheStatus === "cached"
                      ? t("downloadModal.cacheCached")
                      : cacheStatus === "uncached"
                        ? t("downloadModal.cacheUncached")
                        : t("downloadModal.cacheError")}
                </span>
              )}
            </div>
            <span className="dl-option-subtext">{t("downloadModal.useDebridDesc")}</span>
          </div>
          <span className="dl-switch-toggle">
            <input
              type="checkbox"
              checked={useDebrid}
              onChange={(e) => onUseDebrid(e.target.checked)}
            />
            <span className="dl-switch-slider" aria-hidden />
          </span>
        </label>
      )}

      {/* Choose Files Option */}
      {showChooseFiles && (
        <label className={`dl-option-card${chooseFiles ? " is-active" : ""}`}>
          <div className="dl-option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="dl-option-text">
            <span className="dl-option-heading">{t("downloadModal.chooseFiles")}</span>
            <span className="dl-option-subtext">{t("downloadModal.chooseFilesDesc")}</span>
          </div>
          <span className="dl-switch-toggle">
            <input
              type="checkbox"
              checked={chooseFiles}
              onChange={(e) => onChooseFiles(e.target.checked)}
            />
            <span className="dl-switch-slider" aria-hidden />
          </span>
        </label>
      )}
    </div>
  );
}
