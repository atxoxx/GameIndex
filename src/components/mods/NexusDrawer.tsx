import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import type { NexusStatus } from "../../types/mods";

interface NexusDrawerProps {
  currentDomain?: string;
  onDomainSaved: (domain: string) => Promise<void>;
}

const POPULAR_DOMAINS = [
  "skyrimspecialedition",
  "fallout4",
  "cyberpunk2077",
  "witcher3",
  "baldursgate3",
  "stardewvalley",
  "monsterhunterworld",
  "eldenring",
];

export default function NexusDrawer({
  currentDomain,
  onDomainSaved,
}: NexusDrawerProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [domainDraft, setDomainDraft] = useState(currentDomain ?? "");
  const [status, setStatus] = useState<NexusStatus | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);

  const refreshStatus = () => {
    invoke<NexusStatus>("nexus_get_status")
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    setDomainDraft(currentDomain ?? "");
  }, [currentDomain]);

  const handleSaveApiKey = async () => {
    setSavingKey(true);
    try {
      await invoke("nexus_set_api_key", { key: apiKey });
      showToast(
        apiKey.trim() ? t("mods.nexusKeySaved") : t("mods.nexusKeyCleared"),
        "success"
      );
      setApiKey("");
      refreshStatus();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setSavingKey(false);
    }
  };

  const handleSaveDomain = async () => {
    setSavingDomain(true);
    try {
      await onDomainSaved(domainDraft);
      showToast(t("mods.domainSaved"), "success");
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setSavingDomain(false);
    }
  };

  return (
    <div className="mods-nexus-panel" role="region" aria-label={t("mods.nexus")}>
      <div className="mods-nexus-status">
        {status?.connected ? (
          <span className="mods-nexus-connected">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {t("mods.nexusConnected", { name: status.userName ?? "?" })}
            {status.isPremium ? ` · ${t("mods.nexusPremium")}` : ""}
          </span>
        ) : (
          <span className="mods-nexus-disconnected">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {t("mods.nexusNotConnected")}
            {status?.error ? ` (${status.error})` : ""}
          </span>
        )}
      </div>

      {/* API Key Row */}
      <div className="mods-nexus-row">
        <input
          type="password"
          className="mods-nexus-input"
          placeholder={t("mods.nexusApiKey")}
          aria-label={t("mods.nexusApiKey")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSaveApiKey}
          isLoading={savingKey}
        >
          {t("mods.nexusSaveKey")}
        </Button>
      </div>
      <p className="mods-nexus-hint">{t("mods.nexusApiKeyHint")}</p>

      {/* Game Domain Row */}
      <div className="mods-nexus-row">
        <input
          type="text"
          className="mods-nexus-input"
          placeholder={t("mods.nexusDomain")}
          aria-label={t("mods.nexusDomain")}
          value={domainDraft}
          onChange={(e) => setDomainDraft(e.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSaveDomain}
          isLoading={savingDomain}
        >
          {t("common.save")}
        </Button>
      </div>
      <p className="mods-nexus-hint">{t("mods.nexusDomainHint")}</p>

      {/* Popular Domain Quick Chips */}
      <div className="mods-nexus-domains-chips">
        {POPULAR_DOMAINS.map((slug) => (
          <button
            key={slug}
            type="button"
            className={`mods-nexus-domain-chip ${domainDraft === slug ? "active" : ""}`}
            onClick={() => setDomainDraft(slug)}
          >
            {slug}
          </button>
        ))}
      </div>
    </div>
  );
}
