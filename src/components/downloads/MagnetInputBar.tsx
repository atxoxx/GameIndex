import React, { useState } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { PasteIcon, FolderIcon, ChevronIcon } from "./DownloadIcons";

const URI_PATTERN = /^(magnet:|https?:\/\/)/i;

export default function MagnetInputBar() {
  const { addDownload, addDirectDownload, selectSavePath } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Options state
  const [customPath, setCustomPath] = useState<string>(
    () => localStorage.getItem("gamelib-default-download-path") || "",
  );
  const [autoExtract, setAutoExtract] = useState<boolean>(true);
  const [listOnly, setListOnly] = useState<boolean>(false);

  // Detect URI protocol kind
  const trimmed = value.trim();
  const isMagnet = trimmed.startsWith("magnet:");
  const isTorrent = trimmed.endsWith(".torrent") || trimmed.includes(".torrent?");
  const isDirect = !isMagnet && !isTorrent && (trimmed.startsWith("http://") || trimmed.startsWith("https://"));

  async function handlePasteClipboard() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        const text = await navigator.clipboard.readText();
        if (text && URI_PATTERN.test(text.trim())) {
          setValue(text.trim());
          showToast(t("downloads.magnetCopied") || "Pasted from clipboard", "info");
        } else if (text) {
          setValue(text.trim());
        }
      }
    } catch {
      showToast("Unable to read clipboard", "error");
    }
  }

  async function handleChooseCustomPath() {
    try {
      const chosen = await selectSavePath();
      if (chosen) {
        setCustomPath(chosen);
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function startFromUri(rawUri: string) {
    const clean = rawUri.trim();
    if (!clean) return;
    if (!URI_PATTERN.test(clean)) {
      showToast(t("magnetInput.mustBeMagnet"), "error");
      return;
    }
    setSubmitting(true);
    try {
      let finalPath = customPath;
      if (!finalPath) {
        const defaultPath = localStorage.getItem("gamelib-default-download-path") || "";
        const alwaysAsk = localStorage.getItem("gamelib-download-always-ask-path") !== "false";
        if (defaultPath && !alwaysAsk) {
          finalPath = defaultPath;
        } else {
          const chosen = await selectSavePath();
          if (!chosen) {
            setSubmitting(false);
            return;
          }
          finalPath = chosen;
        }
      }

      if (isDirect) {
        let filename = "download.zip";
        try {
          const urlObj = new URL(clean);
          const lastSeg = urlObj.pathname.substring(urlObj.pathname.lastIndexOf("/") + 1);
          if (lastSeg && lastSeg.includes(".")) {
            filename = lastSeg;
          }
        } catch {}

        const fullPath = `${finalPath}/${filename}`.replace(/\\/g, "/");
        await addDirectDownload(clean, fullPath, null, "Manual Direct Link", autoExtract);
      } else {
        await addDownload(clean, finalPath, null, "Direct link", autoExtract, listOnly);
      }

      showToast(t("magnetInput.downloadAdded"), "success");
      setValue("");
      setOptionsOpen(false);
    } catch (err) {
      showToast(t("magnetInput.addFailed", { error: String(err) }), "error");
    } finally {
      setSubmitting(false);
    }
  }

  function extractUriFromDrop(e: React.DragEvent): string | null {
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plain = e.dataTransfer.getData("text/plain");
    const candidate = (uriList || plain || "").trim();
    if (candidate && URI_PATTERN.test(candidate)) {
      const first = candidate.split(/\r?\n/).find((l) => URI_PATTERN.test(l.trim()));
      return (first ?? candidate).trim();
    }
    return null;
  }

  return (
    <div className="dl-quick-add-container">
      <div
        className={`dl-magnet-bar${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!submitting) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (submitting) return;
          const uri = extractUriFromDrop(e);
          if (uri) {
            setValue(uri);
          } else {
            showToast(t("magnetInput.invalidDrop"), "error");
          }
        }}
      >
        <div className="dl-magnet-input-group">
          <svg
            className="dl-magnet-bar-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>

          {isMagnet && <span className="dl-magnet-badge dl-magnet-badge--magnet">MAGNET</span>}
          {isTorrent && <span className="dl-magnet-badge dl-magnet-badge--torrent">TORRENT</span>}
          {isDirect && <span className="dl-magnet-badge dl-magnet-badge--direct">DIRECT HTTP</span>}

          <input
            className="dl-magnet-bar-input"
            type="text"
            placeholder={t("magnetInput.placeholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) startFromUri(value);
            }}
            disabled={submitting}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("magnetInput.inputAria")}
          />

          {!value && (
            <button
              type="button"
              className="dl-magnet-paste-btn"
              onClick={handlePasteClipboard}
              title={t("downloads.pasteClipboard") || "Paste link"}
            >
              <PasteIcon style={{ width: 13, height: 13 }} />
              <span>{t("downloads.pasteClipboard") || "Paste"}</span>
            </button>
          )}

          {value && (
            <button
              type="button"
              className="dl-magnet-clear-btn"
              onClick={() => setValue("")}
              title={t("common.clear")}
            >
              ×
            </button>
          )}
        </div>

        <button
          type="button"
          className={`dl-magnet-options-toggle${optionsOpen ? " active" : ""}`}
          onClick={() => setOptionsOpen(!optionsOpen)}
          title={t("downloadModal.options")}
        >
          <ChevronIcon
            style={{
              width: 12,
              height: 12,
              transform: optionsOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          />
        </button>

        <Button
          variant="primary"
          onClick={() => startFromUri(value)}
          disabled={!value.trim() || submitting}
          isLoading={submitting}
          size="sm"
        >
          {t("common.add")}
        </Button>
      </div>

      {/* Expandable Options Drawer */}
      {optionsOpen && (
        <div className="dl-magnet-options-drawer">
          <div className="dl-magnet-option-row">
            <label className="dl-magnet-path-label">
              <FolderIcon style={{ width: 14, height: 14 }} />
              <span>{t("downloadModal.sectionSave")}:</span>
              <span className="dl-magnet-path-val">
                {customPath || localStorage.getItem("gamelib-default-download-path") || t("downloadModal.chooseFolder")}
              </span>
            </label>
            <Button size="sm" variant="secondary" onClick={handleChooseCustomPath}>
              {t("downloadModal.changeFolder")}
            </Button>
          </div>

          <div className="dl-magnet-toggles-row">
            <label className="dl-magnet-checkbox-label">
              <input
                type="checkbox"
                checked={autoExtract}
                onChange={(e) => setAutoExtract(e.target.checked)}
              />
              <span>{t("downloadModal.autoExtract")}</span>
            </label>

            {!isDirect && (
              <label className="dl-magnet-checkbox-label">
                <input
                  type="checkbox"
                  checked={listOnly}
                  onChange={(e) => setListOnly(e.target.checked)}
                />
                <span>{t("downloadModal.chooseFiles")}</span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
