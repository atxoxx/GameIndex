import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import {
  classifyUri,
  extractMirrors,
  formatUploadDate,
  parseReleaseMetadata,
  resolveSourceUri,
} from "./helpers";
import { ReliabilityBadge } from "./ReliabilityBadge";
import type { SourceReliability } from "./reliability";
import type { DisplayMatch } from "./types";

function typeLabel(
  match: DisplayMatch,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const uri = resolveSourceUri(match, 0);
  const { isMagnet, isTorrentFile, isDirect } = classifyUri(uri, match.torrentUrl);
  if (isMagnet) return t("downloadModal.typeMagnet");
  if (isTorrentFile) return t("downloadModal.typeTorrent");
  if (isDirect) return t("downloadModal.typeDirect");
  return t("downloadModal.typeWeb");
}

/**
 * Side-by-side comparison of up to three pinned results.
 */
export function CompareDrawer({
  matches,
  onClose,
  onSelect,
  installedVersion,
  reliabilityFor,
}: {
  matches: DisplayMatch[];
  onClose: () => void;
  onSelect: (id: string) => void;
  installedVersion?: string | null;
  reliabilityFor: (sourceName: string) => SourceReliability | undefined;
}) {
  const { t, language } = useLanguage();

  const fields: Array<{
    key: string;
    label: string;
    render: (m: DisplayMatch) => React.ReactNode;
  }> = [
    {
      key: "source",
      label: t("downloadModal.detailSource"),
      render: (m) => m.sourceName,
    },
    {
      key: "size",
      label: t("downloadModal.detailSize"),
      render: (m) => m.fileSize || t("downloadModal.unknownSize"),
    },
    {
      key: "group",
      label: t("downloadModal.compareTableGroup"),
      render: (m) => parseReleaseMetadata(m.title, installedVersion).group ?? "—",
    },
    {
      key: "version",
      label: t("downloadModal.compareTableVersion"),
      render: (m) => parseReleaseMetadata(m.title, installedVersion).version ?? "—",
    },
    {
      key: "swarm",
      label: t("downloadModal.compareTableSwarm"),
      render: (m) =>
        m.seeds != null || m.peers != null
          ? `${m.seeds ?? 0} / ${m.peers ?? 0}`
          : "—",
    },
    {
      key: "type",
      label: t("downloadModal.detailType"),
      render: (m) => typeLabel(m, t),
    },
    {
      key: "mirrors",
      label: t("downloadModal.sectionMirrors"),
      render: (m) => String(extractMirrors(m).length),
    },
    {
      key: "reliability",
      label: t("downloadModal.compareTableReliability"),
      render: (m) => <ReliabilityBadge reliability={reliabilityFor(m.sourceName)} compact />,
    },
    {
      key: "date",
      label: t("downloadModal.detailUploaded"),
      render: (m) => (m.uploadDate ? formatUploadDate(m.uploadDate, language) : "—"),
    },
    {
      key: "match",
      label: t("downloadModal.compareTableMatch"),
      render: (m) => `${Math.round(m.matchScore * 100)}%`,
    },
  ];

  return createPortal(
    <div
      className="modal-backdrop dl-compare-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal dl-compare-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("downloadModal.compareTitle")}
      >
        <div className="dl-compare-header">
          <h3 className="dl-compare-heading">{t("downloadModal.compareTitle")}</h3>
          <button
            type="button"
            className="dl-modal-close-button"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="dl-compare-scroll">
          <table className="dl-compare-table">
            <thead>
              <tr>
                <th className="dl-compare-field-col" />
                {matches.map((m) => (
                  <th key={m.id} className="dl-compare-render-col" title={m.title}>
                    <span className="dl-compare-col-source">{m.sourceName}</span>
                    <span className="dl-compare-col-title">{m.title}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.key}>
                  <th scope="row" className="dl-compare-field-col">
                    {field.label}
                  </th>
                  {matches.map((m) => (
                    <td key={m.id} className="dl-compare-render-col">
                      {field.render(m)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="dl-compare-field-col" />
                {matches.map((m) => (
                  <td key={m.id} className="dl-compare-render-col">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        onSelect(m.id);
                        onClose();
                      }}
                    >
                      {t("downloadModal.selectThis")}
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}
