// Configure mod sources: API keys (keychain) and the per-game mapping
// that tells each site which game to browse.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, KeyRound, Link2, Trash2 } from "lucide-react";
import { Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { ModSourceInfo } from "../../../types/mods";
import "./mods-discover.css";

interface SourceConfigModalProps {
  open: boolean;
  gameId: string | null;
  gameName?: string;
  sources: ModSourceInfo[];
  onClose: () => void;
  onSetCredential: (source: string, key: string) => Promise<void>;
  onSetLink: (source: string, externalId: string, displayName?: string) => Promise<void>;
  onClearLink: (source: string) => Promise<void>;
}

export default function SourceConfigModal({
  open,
  gameId,
  gameName,
  sources,
  onClose,
  onSetCredential,
  onSetLink,
  onClearLink,
}: SourceConfigModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

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
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(null);
    }
  };

  return createPortal(
    <div
      className="modal-backdrop mods-discover-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("mods.source.configTitle")}
    >
      <div className="modal mods-source-modal">
        <div className="mods-source-modal-header">
          <div>
            <h2>{t("mods.source.configTitle")}</h2>
            <p>{t("mods.source.configSubtitle")}</p>
            {gameName && (
              <span className="mods-source-modal-game">
                {t("mods.source.forGame", { game: gameName })}
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("mods.source.close")}
          </Button>
        </div>

        <div className="mods-source-modal-body">
          {sources.map((s) => (
            <div key={s.id} className="mods-source-card">
              <div className="mods-source-card-head">
                <div>
                  <h3>{s.name}</h3>
                  <button
                    type="button"
                    className="mods-source-link"
                    onClick={() => void openUrl(s.homepage)}
                  >
                    {s.homepage.replace(/^https?:\/\//, "")}
                    <ExternalLink size={12} />
                  </button>
                </div>
                <span
                  className={`mods-source-status ${s.hasCredential || !s.requiresCredential ? "is-ok" : "is-missing"}`}
                >
                  {s.requiresCredential
                    ? s.hasCredential
                      ? t("mods.source.connected")
                      : t("mods.source.notConnected")
                    : t("mods.source.noKeyNeeded")}
                </span>
              </div>

              {s.id === "workshop" && (
                <p className="mods-source-note">{t("mods.source.steamWorkshopNote")}</p>
              )}

              {s.requiresCredential && s.id !== "workshop" && (
                <div className="mods-source-field">
                  <label className="mods-source-field-label">
                    <KeyRound size={13} /> {t("mods.source.apiKey")}
                  </label>
                  <div className="mods-source-field-row">
                    <input
                      type="password"
                      className="mods-source-input"
                      placeholder={s.hasCredential ? "••••••••" : t("mods.source.apiKeyPlaceholder")}
                      value={keyDrafts[s.id] ?? ""}
                      onChange={(e) =>
                        setKeyDrafts((d) => ({ ...d, [s.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={saving === s.id}
                      onClick={() => void handleSaveKey(s.id)}
                    >
                      {t("mods.source.save")}
                    </Button>
                  </div>
                </div>
              )}

              {gameId && (
                <div className="mods-source-field">
                  <label className="mods-source-field-label">
                    <Link2 size={13} /> {t("mods.source.gameMapping")}
                  </label>
                  <div className="mods-source-field-row">
                    <input
                      type="text"
                      className="mods-source-input"
                      placeholder={s.externalId ?? t("mods.source.mappingPlaceholder")}
                      value={linkDrafts[s.id] ?? ""}
                      onChange={(e) =>
                        setLinkDrafts((d) => ({ ...d, [s.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={saving === s.id}
                      onClick={() => void handleSaveLink(s.id)}
                    >
                      {t("mods.source.setMapping")}
                    </Button>
                    {s.externalId && (
                      <button
                        type="button"
                        className="mods-source-clear"
                        title={t("mods.source.clear")}
                        aria-label={t("mods.source.clear")}
                        onClick={() => void handleClearLink(s.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {s.externalId && (
                    <span className="mods-source-mapped">
                      {t("mods.source.mapped", { id: s.externalId })}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
