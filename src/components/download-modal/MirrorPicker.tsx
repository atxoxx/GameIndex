import { hostLabelForUri } from "./helpers";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Modern Mirror / hoster selector.
 * Renders each mirror URI as a scannable host chip with active radio indicator
 * so the user can quickly pick and compare hosters.
 */
export function MirrorPicker({
  uris,
  selectedMirrorIdx,
  onChange,
}: {
  uris: string[];
  selectedMirrorIdx: number;
  onChange: (idx: number) => void;
}) {
  const { t } = useLanguage();
  if (uris.length <= 1) return null;

  return (
    <div className="dl-mirrors-grid" role="radiogroup" aria-label={t("downloadModal.selectMirror")}>
      {uris.map((uri, idx) => {
        const hoster = hostLabelForUri(uri, idx);
        const selected = idx === selectedMirrorIdx;
        return (
          <button
            key={idx}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`dl-mirror-button${selected ? " selected" : ""}`}
            onClick={() => onChange(idx)}
            title={uri}
          >
            <span className="dl-mirror-indicator" aria-hidden>
              {selected && <span className="dl-mirror-dot" />}
            </span>
            <span className="dl-mirror-title">{hoster}</span>
            <span className="dl-mirror-index">#{idx + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
