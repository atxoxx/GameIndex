import { useLanguage } from "../../context/LanguageContext";

/**
 * Download options: auto-extract toggle, an optional debrid toggle, and
 * (for plain P2P torrents) the "choose files" toggle. Rendered inside
 * the detail panel, which supplies the section heading — this component
 * only draws the switch rows so the whole pane reads as one organised
 * surface.
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
}: {
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  isDirect: boolean;
  useDebrid: boolean;
  onUseDebrid: (v: boolean) => void;
  debridAvailable: boolean;
}) {
  const { t } = useLanguage();
  // Debrid downloads the whole file, so per-file selection only makes
  // sense on the plain P2P path.
  const showChooseFiles = !isDirect && !(useDebrid && debridAvailable);
  return (
    <div className="dl-options-card">
      <label className="dl-switch-row">
        <span className="dl-switch-label">
          {t('downloadModal.autoExtract')}
        </span>
        <span className="dl-switch">
          <input
            type="checkbox"
            checked={autoExtract}
            onChange={(e) => onAutoExtract(e.target.checked)}
          />
          <span className="dl-switch-track" aria-hidden>
            <span className="dl-switch-thumb" />
          </span>
        </span>
      </label>

      {debridAvailable && (
        <label className="dl-switch-row">
          <span className="dl-switch-label">{t('downloadModal.useDebrid')}</span>
          <span className="dl-switch">
            <input
              type="checkbox"
              checked={useDebrid}
              onChange={(e) => onUseDebrid(e.target.checked)}
            />
            <span className="dl-switch-track" aria-hidden>
              <span className="dl-switch-thumb" />
            </span>
          </span>
        </label>
      )}

      {showChooseFiles && (
        <label className="dl-switch-row">
          <span className="dl-switch-label">{t('downloadModal.chooseFiles')}</span>
          <span className="dl-switch">
            <input
              type="checkbox"
              checked={chooseFiles}
              onChange={(e) => onChooseFiles(e.target.checked)}
            />
            <span className="dl-switch-track" aria-hidden>
              <span className="dl-switch-thumb" />
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
