import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import {
  type Emulator,
  type KnownEmulator,
  KNOWN_EMULATORS,
} from "../types/emulator";
import { Button } from "../components/ui";

interface Props {
  /** Existing emulator to edit, or null/undefined to add a new one. */
  emulator?: Emulator | null;
  /** A known catalog entry to pre-select when adding a brand-new emulator. */
  presetKnown?: KnownEmulator | null;
  onClose: () => void;
  onSaved: (emulator: Emulator, scanAfter: boolean) => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export default function EmulatorEditorModal({
  emulator,
  presetKnown,
  onClose,
  onSaved,
}: Props) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const isEdit = !!emulator;

  const [knownKey, setKnownKey] = useState<string>(() => {
    if (emulator) {
      const hit = KNOWN_EMULATORS.find(
        (k) => k.name === emulator.name && k.platform === emulator.platform
      );
      return hit?.key ?? "custom";
    }
    return presetKnown?.key ?? "";
  });
  const [name, setName] = useState(emulator?.name ?? presetKnown?.name ?? "");
  const [platform, setPlatform] = useState(emulator?.platform ?? presetKnown?.platform ?? "");
  const [executablePath, setExecutablePath] = useState(emulator?.executablePath ?? "");
  const [romFolder, setRomFolder] = useState(emulator?.romFolder ?? "");
  const [argumentsTemplate, setArgumentsTemplate] = useState(
    emulator?.argumentsTemplate ?? presetKnown?.argumentsTemplate ?? '"%ROM%"'
  );
  const [notes, setNotes] = useState(emulator?.notes ?? "");
  const [scanAfter, setScanAfter] = useState(false);
  const [saving, setSaving] = useState(false);

  function applyKnown(k: KnownEmulator) {
    setKnownKey(k.key);
    setName(k.name);
    setPlatform(k.platform);
    setArgumentsTemplate(k.argumentsTemplate);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedKnown = useMemo(
    () => KNOWN_EMULATORS.find((k) => k.key === knownKey),
    [knownKey]
  );

  async function pickExecutable() {
    try {
      const p = await open({
        multiple: false,
        directory: false,
        title: t("emulators.browseExe"),
        filters: [{ name: "Executable", extensions: ["exe", "app", "sh", "AppImage"] }],
      });
      if (typeof p !== "string") return;
      setExecutablePath(p);
      if (!name.trim()) {
        const base = p.split(/[\\/]/).pop()?.toLowerCase() ?? "";
        const hit = KNOWN_EMULATORS.find((k) => k.executableName.toLowerCase() === base);
        if (hit) {
          setKnownKey(hit.key);
          setName(hit.name);
          setPlatform(hit.platform);
          setArgumentsTemplate(hit.argumentsTemplate);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function pickFolder() {
    try {
      const p = await open({ multiple: false, directory: true, title: t("emulators.browseFolder") });
      if (typeof p === "string") setRomFolder(p);
    } catch (err) {
      console.error(err);
    }
  }

  async function testLaunch() {
    if (!executablePath.trim()) {
      showToast(t("emulators.launcherNotSet"), "error");
      return;
    }
    try {
      await openPath(executablePath.trim());
      showToast(t("emulators.launchExeSuccess", { name }), "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      showToast(t("emulators.name") + " required", "error");
      return;
    }
    if (!executablePath.trim()) {
      showToast(t("emulators.launcherNotSet"), "error");
      return;
    }
    if (!romFolder.trim()) {
      showToast(t("emulators.folderNotSet"), "error");
      return;
    }
    setSaving(true);
    const now = Date.now();
    const payload: Emulator = {
      id: emulator?.id ?? `emu-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      platform: platform.trim() || (selectedKnown?.platform ?? "Unknown"),
      executablePath: executablePath.trim(),
      argumentsTemplate: argumentsTemplate.trim() || '"%ROM%"',
      romFolder: romFolder.trim(),
      notes: notes.trim() || undefined,
      iconUrl: emulator?.iconUrl ?? selectedKnown?.logo,
      createdAt: emulator?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await invoke("save_emulator", { emulator: payload });
      showToast(
        isEdit ? t("emulators.edit") + " ✓" : t("emulators.addEmulator") + " ✓",
        "success"
      );
      onSaved(payload, scanAfter);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  const argPresets = ['"%ROM%"', '-f "%ROM%"', '-g "%ROM%"', '--fullscreen "%ROM%"', '-L "%ROM%"'];

  return (
    <div className="modal-overlay emulators-modal-overlay" onMouseDown={onClose}>
      <div
        className="modal emulators-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? t("emulators.editor.title.edit") : t("emulators.editor.title.add")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-text">
            <h2>
              {isEdit ? t("emulators.editor.title.edit") : t("emulators.editor.title.add")}
            </h2>
            <p className="modal-subtitle">
              {isEdit ? selectedKnown?.name || name : t("emulators.knownHint")}
            </p>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body emulators-editor-body">
          <label className="emulators-field">
            <span>{t("emulators.selectKnown")}</span>
            <select
              value={knownKey}
              onChange={(e) => {
                const k = e.target.value;
                if (k === "custom") {
                  setKnownKey("custom");
                  return;
                }
                const hit = KNOWN_EMULATORS.find((x) => x.key === k);
                if (hit) applyKnown(hit);
              }}
            >
              <option value="custom">{t("emulators.custom")}</option>
              {KNOWN_EMULATORS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.glyph} {k.name} — {k.platform}
                </option>
              ))}
            </select>
          </label>

          {selectedKnown && (
            <p className="emulators-known-hint">{selectedKnown.description}</p>
          )}

          {selectedKnown?.logo && (
            <div
              className="emulators-known-logo"
              style={{ ["--emu-accent" as string]: selectedKnown.accent }}
            >
              <img src={selectedKnown.logo} alt="" />
              <div className="emulators-known-logo-info">
                <span className="emulators-known-logo-name">{selectedKnown.name}</span>
                <span className="emulators-known-logo-platform">{selectedKnown.platform}</span>
              </div>
            </div>
          )}

          <div className="emulators-field-row">
            <label className="emulators-field">
              <span>{t("emulators.name")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dolphin"
              />
            </label>
            <label className="emulators-field">
              <span>{t("emulators.platform")}</span>
              <input
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="GameCube"
              />
            </label>
          </div>

          <label className="emulators-field">
            <span>{t("emulators.executable")}</span>
            <div className="emulators-path-row">
              <input
                value={executablePath}
                onChange={(e) => setExecutablePath(e.target.value)}
                placeholder="C:\emu\dolphin.exe"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={
                  <svg {...ICON}>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                }
                onClick={pickExecutable}
              >
                {t("emulators.browseExe")}
              </Button>
            </div>
          </label>

          <label className="emulators-field">
            <span>{t("emulators.romFolder")}</span>
            <div className="emulators-path-row">
              <input
                value={romFolder}
                onChange={(e) => setRomFolder(e.target.value)}
                placeholder="C:\roms\gamecube"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={
                  <svg {...ICON}>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                }
                onClick={pickFolder}
              >
                {t("emulators.browseFolder")}
              </Button>
            </div>
          </label>

          <label className="emulators-field">
            <div className="emulators-field-header">
              <span>{t("emulators.argumentsTemplate")}</span>
              <div className="emulators-presets-row">
                {argPresets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="emu-preset-pill"
                    onClick={() => setArgumentsTemplate(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={argumentsTemplate}
              onChange={(e) => setArgumentsTemplate(e.target.value)}
              placeholder='"%ROM%"'
            />
            <small className="emulators-hint">{t("emulators.argumentsHint")}</small>
          </label>

          {selectedKnown && (
            <p className="emulators-extensions">
              {t("emulators.extensions")}:{" "}
              {selectedKnown.extensions.map((e) => `.${e}`).join(" ")}
            </p>
          )}

          <label className="emulators-field">
            <span>{t("emulators.notes")}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes or configuration tweaks..."
            />
          </label>

          {!isEdit && (
            <label className="emulators-checkbox">
              <input
                type="checkbox"
                checked={scanAfter}
                onChange={(e) => setScanAfter(e.target.checked)}
              />
              <span>{t("emulators.editor.scanAfter")}</span>
            </label>
          )}
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            <Button
              variant="secondary"
              size="sm"
              onClick={testLaunch}
              disabled={!executablePath.trim()}
              title={t("emulators.editor.testLaunch")}
              leftIcon={
                <svg {...ICON}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              }
            >
              {t("emulators.editor.testLaunch")}
            </Button>
          </div>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={handleSave} isLoading={saving}>
              {t("emulators.editor.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
