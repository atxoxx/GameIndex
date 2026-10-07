// List-layout row for one remote mod result.

import { useState } from "react";
import { Download, ExternalLink, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, formatRemoteDate, sourceLabel } from "./format";
import "./mods-discover.css";

interface RemoteModRowProps {
  mod: RemoteModSummary;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
}

export default function RemoteModRow({ mod, onOpen, onOpenExternal }: RemoteModRowProps) {
  const { t } = useLanguage();
  const [broken, setBroken] = useState(false);
  const updated = formatRemoteDate(mod.updatedAt);

  return (
    <div className="mods-discover-row">
      <button
        type="button"
        className="mods-discover-row-main"
        onClick={() => onOpen(mod)}
        title={mod.name}
      >
        <div className="mods-discover-row-thumb">
          {mod.thumbnailUrl && !broken ? (
            <img src={mod.thumbnailUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span>{mod.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="mods-discover-row-info">
          <div className="mods-discover-row-topline">
            <span className="mods-discover-row-name">{mod.name}</span>
            <span className="mods-discover-row-source">{sourceLabel(mod.source)}</span>
          </div>
          <span className="mods-discover-row-author">
            {mod.author}
            {mod.version ? ` · v${mod.version}` : ""}
            {updated ? ` · ${t("mods.discover.updated", { date: updated })}` : ""}
          </span>
          {mod.summary && <p className="mods-discover-row-summary">{mod.summary}</p>}
        </div>
        <div className="mods-discover-row-stats">
          {mod.downloads != null && (
            <span title={t("mods.discover.downloads")}>
              <Download size={12} /> {formatCount(mod.downloads)}
            </span>
          )}
          {mod.endorsements != null && (
            <span title={t("mods.discover.endorsements")}>
              <ThumbsUp size={12} /> {formatCount(mod.endorsements)}
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        className="mods-discover-icon-btn"
        onClick={() => onOpenExternal(mod)}
        title={t("mods.discover.openPage")}
        aria-label={t("mods.discover.openPage")}
      >
        <ExternalLink size={14} />
      </button>
    </div>
  );
}
