import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
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
  onSetCredential: (source: string, key: string) => Promise<void>;
  onSetLink: (source: string, externalId: string, displayName?: string) => Promise<void>;
  onClearLink: (source: string) => Promise<void>;
}

export default function DiscoverSourcesTab({
  gameId,
  gameName,
  sources,
  resolving,
  onResolve,
  onSetCredential,
  onSetLink,
  onClearLink,
}: DiscoverSourcesTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const handleSaveKey = async (source: string) => {
    const key = keyDrafts[source] ?? "";
    setSaving(source);
    try {
      await onSetCredential(source, key);
      showToast(t("mods.source.keySaved"), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(null);
    }
  };

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

      <div className="mods-discover-sources-grid">
        {sources.map((source) => {
          const isSaving = saving === source.id;
          const keyDraft = keyDrafts[source.id] ?? "";
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

              {/* API Key credential row */}
              {source.requiresCredential && (
                <div className="mods-discover-source-form-group">
                  <div className="mods-discover-source-form-label">
                    <KeyRound size={13} />
                    <span>{t("mods.source.apiKey")}</span>
                    {source.hasCredential && (
                      <span className="mods-discover-key-saved-tag">
                        ✓ {t("mods.source.keySavedBadge")}
                      </span>
                    )}
                  </div>
                  <div className="mods-discover-source-input-row">
                    <input
                      type="password"
                      className="mods-discover-input"
                      placeholder={
                        source.hasCredential
                          ? "••••••••••••••••"
                          : t("mods.source.apiKeyPlaceholder")
                      }
                      value={keyDraft}
                      onChange={(e) =>
                        setKeyDrafts((d) => ({ ...d, [source.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isSaving || !keyDraft.trim()}
                      onClick={() => void handleSaveKey(source.id)}
                    >
                      {t("common.save")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Game link / slug row */}
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
