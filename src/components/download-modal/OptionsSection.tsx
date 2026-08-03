import { useLanguage } from "../../context/LanguageContext";

/**
 * Download options: auto-extract toggle and (for torrents) the
 * "choose files" toggle. Rendered inside the detail panel, which
 * supplies the section heading — this component only draws the
 * switch rows so the whole pane reads as one organised surface.
 */
export function OptionsSection({
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
  isDirect,
}: {
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  isDirect: boolean;
}) {
  const { t } = useLanguage();
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

      {!isDirect && (
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
