import { useState } from "react";
import { Link } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { ModSourceInfo } from "../../../types/mods";
import "./mods-discover.css";

interface DiscoverSourcesTabProps {
  gameId: string | null;
  gameName?: string;
  sources: ModSourceInfo[];
  resolving: boolean;
  onResolve: () => void;
  onSetLink: (source: string, externalId: string, displayName?: string) => Promise<void>;
  onClearLink: (source: string) => Promise<void>;
}

export default function DiscoverSourcesTab({
  gameId,
  gameName,
  sources,
  resolving,
  onResolve,
  onSetLink,
  onClearLink,
}: DiscoverSourcesTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const handleSaveLink = async (source: string) => {
    const value = (linkDrafts[source] ?? "").trim();
    if (!value) return;
    setSaving(source);
    try {
      await onSetLink(source, value, value);
      showToast(t("mods.source.linkSaved"), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(null);
    }
  };

  const handleClearLink = async (source: string) => {
    setSaving(source);
    try {
      await onClearLink(source);
      setLinkDrafts((d) => ({ ...d, [source]: "" }));
      showToast(t("mods.source.linkCleared"), "info");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mods-discover-sources-view">
      <div className="mods-discover-sources-banner">
        <div className="mods-discover-sources-banner-info">
          <h3>{t("mods.discover.sourcesTabTitle")}</h3>
          <p>
            {gameName
              ? t("mods.discover.sourcesTabSubtitleGame", { name: gameName })
              : t("mods.discover.sourcesTabSubtitle")}
          </p>
        </div>

        <div className="mods-discover-sources-banner-actions">
          <Link
            className="mods-discover-sources-settings-link"
            to="/settings/integrations?section=section-mods"
          >
            <Settings2 size={13} />
            {t("mods.openSettings")}
          </Link>
          <Button
            variant="secondary"
            size="sm"
            disabled={!gameId || resolving}
            onClick={onResolve}
            leftIcon={<RefreshCw size={14} className={resolving ? "spinning" : undefined} />}
          >
            {resolving ? t("mods.discover.detecting") : t("mods.discover.detectSources")}
          </Button>
        </div>
      </div>

      <div className="mods-discover-sources-grid">
        {sources.map((source) => {
          const isSaving = saving === source.id;
          const linkDraft = linkDrafts[source.id] ?? source.externalId ?? "";

          return (
            <div key={source.id} className={`mods-discover-source-card source-${source.id}`}>
              <div className="mods-discover-source-card-head">
                <div className="mods-discover-source-card-title">
                  <span className="mods-discover-source-card-name">{source.name}</span>
                  <button
                    type="button"
                    className="mods-discover-source-link-icon"
                    onClick={() => void openUrl(source.homepage)}
                    title={source.homepage}
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>

                <div className="mods-discover-source-status-badge">
                  {source.available ? (
                    <span className="mods-discover-status-ready">
                      <CheckCircle2 size={13} /> {t("mods.source.statusReady")}
                    </span>
                  ) : source.requiresCredential && !source.hasCredential ? (
                    <span className="mods-discover-status-warn">
                      <ShieldAlert size={13} /> {t("mods.source.statusNeedsKey")}
                    </span>
                  ) : (
                    <span className="mods-discover-status-unlinked">
                      {t("mods.source.statusUnlinked")}
                    </span>
                  )}
                </div>
              </div>

              {source.note && (
                <p className="mods-discover-source-note">{source.note}</p>
              )}

              {/* Game link / slug row — API keys live in Settings. */}
              {gameId && (
                <div className="mods-discover-source-form-group">
                  <div className="mods-discover-source-form-label">
                    <Link2 size={13} />
                    <span>{t("mods.source.gameSlug")}</span>
                    {source.externalLabel && (
                      <span className="mods-discover-slug-tag">
                        {source.externalLabel}
                      </span>
                    )}
                  </div>
                  <div className="mods-discover-source-input-row">
                    <input
                      type="text"
                      className="mods-discover-input"
                      placeholder={t("mods.source.gameSlugPlaceholder")}
                      value={linkDraft}
                      onChange={(e) =>
                        setLinkDrafts((d) => ({ ...d, [source.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isSaving || linkDraft.trim() === (source.externalId ?? "")}
                      onClick={() => void handleSaveLink(source.id)}
                    >
                      {t("common.save")}
                    </Button>

                    {source.externalId && (
                      <button
                        type="button"
                        className="mods-discover-icon-btn mods-discover-icon-btn--danger"
                        title={t("mods.source.clear")}
                        disabled={isSaving}
                        onClick={() => void handleClearLink(source.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
