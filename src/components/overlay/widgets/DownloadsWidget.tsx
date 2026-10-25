import { Download } from "lucide-react";
import { useDownloads } from "../../../context/DownloadContext";
import { useLanguage } from "../../../context/LanguageContext";
import { formatProgress } from "../../../types/download";
import { Badge, Card } from "../../ui";
import type { OverlayWidgetProps } from "./types";

/** Active download progress from the download store. */
export default function DownloadsWidget({ bare = false }: OverlayWidgetProps) {
  const { activeDownloads, activeCount } = useDownloads();
  const { t } = useLanguage();

  return (
    <Card variant="glass" className="overlay-widget">
      {!bare && (
        <div className="overlay-widget__head">
          <span className="overlay-widget__icon" aria-hidden>
            <Download />
          </span>
          <h3 className="overlay-widget__title">{t("overlay.widget.downloads")}</h3>
          {activeCount > 0 && <Badge variant="info">{activeCount}</Badge>}
        </div>
      )}

      {activeCount === 0 ? (
        <p className="overlay-widget__empty">{t("overlay.downloads.none")}</p>
      ) : (
        <ul className="overlay-list">
          {activeDownloads.slice(0, 4).map((download) => (
            <li key={download.id} className="overlay-list__row">
              <span className="overlay-list__name">{download.name}</span>
              <span className="overlay-list__meta">
                {formatProgress(download.progress)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
