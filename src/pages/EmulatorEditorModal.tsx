import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Play,
  RefreshCw,
  Save,
  StickyNote,
  Terminal,
  X,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../context/ToastContext";
import {
  type Emulator,
  type KnownEmulator,
  KNOWN_EMULATORS,
  argumentsTemplateForHost,
  linuxLaunchPresets,
} from "../types/emulator";
import { Button } from "../components/ui";
import "../styles/emulator-editor.css";

interface Props {
  /** Existing emulator to edit, or null/undefined to add a new one. */
  emulator?: Emulator | null;
  /** A known catalog entry to pre-select when adding a brand-new emulator. */
  presetKnown?: KnownEmulator | null;
  onClose: () => void;
  onSaved: (emulator: Emulator, scanAfter: boolean) => void;
}

const ARG_PRESETS = [
  '"%ROM%"',
  '-f "%ROM%"',
  '-g "%ROM%"',
  '--fullscreen "%ROM%"',
  '-L "%ROM%"',
];

function baseName(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  return trimmed.split(/[\\\\/]/).filter(Boolean).pop() ?? trimmed;
}

export default function EmulatorEditorModal({
  emulator,
  presetKnown,
  onClose,
  onSaved,
}: Props) {
  const { t } = useLanguage();
  const { hostPlatform, isLinuxHost } = useSettings();
  const { showToast } = useToast();
  const isEdit = !!emulator;

  const [knownKey, setKnownKey] = useState<string>(() => {
    if (emulator) {
      const hit = KNOWN_EMULATORS.find(
        (k) => k.name === emulator.name && k.platform === emulator.platform
      );
      return hit?.key ?? "custom";
    }
    return presetKnown?.key ?? "custom";
  });
  const [name, setName] = useState(emulator?.name ?? presetKnown?.name ?? "");
  const [platform, setPlatform] = useState(emulator?.platform ?? presetKnown?.platform ?? "");
  const [executablePath, setExecutablePath] = useState(emulator?.executablePath ?? "");
  const [romFolder, setRomFolder] = useState(emulator?.romFolder ?? "");
  const [argumentsTemplate, setArgumentsTemplate] = useState(
    emulator?.argumentsTemplate ??
      (presetKnown ? argumentsTemplateForHost(presetKnown, hostPlatform) : '"%ROM%"')
  );
  const [notes, setNotes] = useState(emulator?.notes ?? "");
  const [biosFolder, setBiosFolder] = useState(emulator?.biosFolder ?? "");
  const [savesFolder, setSavesFolder] = useState(emulator?.savesFolder ?? "");
  const [autoScan, setAutoScan] = useState(emulator?.autoScan ?? false);
  const [scanAfter, setScanAfter] = useState(false);
  const [saving, setSaving] = useState(false);

  function applyKnown(k: KnownEmulator) {
    setKnownKey(k.key);
    setName(k.name);
    setPlatform(k.platform);
    setArgumentsTemplate(argumentsTemplateForHost(k, hostPlatform));
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

  const sortedKnown = useMemo(
    () => [...KNOWN_EMULATORS].sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  const linuxPresets = useMemo(
    () => (isLinuxHost && selectedKnown ? linuxLaunchPresets(selectedKnown) : []),
    [isLinuxHost, selectedKnown]
  );

  const missing = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push(t("emulators.name"));
    if (!executablePath.trim()) out.push(t("emulators.executable"));
    if (!romFolder.trim()) out.push(t("emulators.romFolder"));
    return out;
  }, [name, executablePath, romFolder, t]);

  const complete = missing.length === 0;

  const preview = useMemo(() => {
    const exe = baseName(executablePath) || (isLinuxHost ? "emulator" : "emulator.exe");
    const args = (argumentsTemplate.trim() || '"%ROM%"').replace(/%ROM%/g, "Game.iso");
    return `${exe} ${args}`.trim();
  }, [executablePath, argumentsTemplate, isLinuxHost]);

  async function pickExecutable() {
    try {
      const p = await open({
        multiple: false,
        directory: false,
        title: t("emulators.browseExe"),
        filters: isLinuxHost
          ? [
              {
                name: "Executable",
                extensions: ["AppImage", "appimage", "sh", "bin", "run"],
              },
              { name: "All files", extensions: ["*"] },
            ]
          : [{ name: "Executable", extensions: ["exe", "app", "sh", "AppImage"] }],
      });
      if (typeof p !== "string") return;
      setExecutablePath(p);
      if (!name.trim()) {
        const base = p.split(/[\\\\/]/).pop()?.toLowerCase() ?? "";
        const hit = KNOWN_EMULATORS.find(
          (k) =>
            k.executableName.toLowerCase() === base ||
            k.linuxExecutableName?.toLowerCase() === base
        );
        if (hit) applyKnown(hit);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function pickFolder() {
    try {
      const p = await open({
        multiple: false,
        directory: true,
        title: t("emulators.browseFolder"),
      });
      if (typeof p === "string") setRomFolder(p);
    } catch (err) {
      console.error(err);
    }
  }

  async function pickDir(set: (v: string) => void, title: string) {
    try {
      const p = await open({ multiple: false, directory: true, title });
      if (typeof p === "string") set(p);
    } catch (err) {
      console.error(err);
    }
  }

  async function openFolder(path: string) {
    if (!path.trim()) return;
    try {
      await invoke("open_folder", { path: path.trim() });
    } catch (err) {
      showToast(String(err), "error");
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
    if (!complete) {
      showToast(missing.join(" · "), "error");
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
      biosFolder: biosFolder.trim() || undefined,
      savesFolder: savesFolder.trim() || undefined,
      autoScan,
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
      setSaving(false);
    }
  }

  const accentStyle = {
    ["--emu-accent" as string]: selectedKnown?.accent ?? "var(--color-accent)",
  };

  return createPortal(
    <div className="modal-overlay emulators-modal-overlay" onMouseDown={onClose}>
      <div
        className="modal emulators-modal emu-editor"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? t("emulators.editor.title.edit") : t("emulators.editor.title.add")}
        onMouseDown={(e) => e.stopPropagation()}
        style={accentStyle}
      >
        <header className="emu-editor__head">
          <div className="emu-editor__mark" aria-hidden>
            {selectedKnown?.logo ? (
              <img src={selectedKnown.logo} alt="" />
            ) : selectedKnown ? (
              <span>{selectedKnown.glyph}</span>
            ) : (
              <Gamepad2 size={24} />
            )}
          </div>
          <div className="emu-editor__title">
            <span className="emu-editor__eyebrow">
              {isEdit ? t("emulators.editor.title.edit") : t("emulators.editor.title.add")}
            </span>
            <h2>{name.trim() || t("emulators.custom")}</h2>
            <p>
              {platform.trim() || t("emulators.knownHint")}
              <span className={`emu-editor__status-dot${complete ? " is-ready" : ""}`} aria-hidden />
              {complete ? t("emulators.editor.ready") : t("emulators.editor.missingFields", { count: missing.length })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t("common.close")}
            onClick={onClose}
            leftIcon={<X size={18} />}
          />
        </header>

        <div className="emu-editor__body">
          <div className="emu-editor__main">
            <section className="emu-editor__section">
              <header className="emu-editor__section-head">
                <span className="emu-editor__section-icon"><Gamepad2 size={15} /></span>
                <div>
                  <h3>{t("emulators.editor.section.identity")}</h3>
                  <p>{t("emulators.editor.identityHint")}</p>
                </div>
              </header>

              <label className="emu-editor__field">
                <span>{t("emulators.selectKnown")}</span>
                <select
                  value={knownKey}
                  autoFocus={!isEdit && !presetKnown}
                  onChange={(e) => {
                    const key = e.target.value;
                    if (key === "custom") {
                      setKnownKey("custom");
                      return;
                    }
                    const hit = KNOWN_EMULATORS.find((x) => x.key === key);
                    if (hit) applyKnown(hit);
                  }}
                >
                  <option value="custom">{t("emulators.custom")}</option>
                  {sortedKnown.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.glyph} {k.name} — {k.platform}
                    </option>
                  ))}
                </select>
              </label>

              {selectedKnown ? (
                <div className="emu-editor__known">
                  <div className="emu-editor__known-mark" aria-hidden>
                    {selectedKnown.logo ? (
                      <img src={selectedKnown.logo} alt="" />
                    ) : (
                      <span>{selectedKnown.glyph}</span>
                    )}
                  </div>
                  <div className="emu-editor__known-text">
                    <strong>{selectedKnown.name}</strong>
                    <span>{selectedKnown.description}</span>
                    <div className="emu-editor__chips">
                      <span className="emu-editor__chip">{selectedKnown.platform}</span>
                      {selectedKnown.extensions.slice(0, 6).map((ext) => (
                        <span key={ext} className="emu-editor__chip emu-editor__chip--mono">.{ext}</span>
                      ))}
                    </div>
                  </div>
                  <div className="emu-editor__known-actions">
                    {selectedKnown.githubUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        leftIcon={<ExternalLink size={14} />}
                        aria-label={t("emulators.github")}
                        title={t("emulators.github")}
                        onClick={() => void openUrl(selectedKnown.githubUrl!)}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<RefreshCw size={13} />}
                      title={t("emulators.editor.resetPreset")}
                      onClick={() => applyKnown(selectedKnown)}
                    >
                      {t("emulators.editor.resetPreset")}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="emu-editor__hint">{t("emulators.knownHint")}</p>
              )}

              <div className="emu-editor__grid">
                <label className="emu-editor__field">
                  <span>
                    {t("emulators.name")}
                    <em className="emu-editor__req">{t("emulators.editor.required")}</em>
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dolphin"
                    aria-invalid={!name.trim()}
                  />
                </label>
                <label className="emu-editor__field">
                  <span>{t("emulators.platform")}</span>
                  <input
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    placeholder="GameCube"
                  />
                </label>
              </div>
            </section>

            <section className="emu-editor__section">
              <header className="emu-editor__section-head">
                <span className="emu-editor__section-icon"><Cpu size={15} /></span>
                <div>
                  <h3>{t("emulators.editor.section.application")}</h3>
                  <p>{t("emulators.editor.executableHint")}</p>
                </div>
              </header>

              <label className="emu-editor__field">
                <span>
                  {t("emulators.executable")}
                  <em className="emu-editor__req">{t("emulators.editor.required")}</em>
                </span>
                <div className="emu-editor__path">
                  <input
                    value={executablePath}
                    onChange={(e) => setExecutablePath(e.target.value)}
                    placeholder={isLinuxHost ? "/usr/bin/retroarch" : "C:\\emu\\dolphin.exe"}
                    aria-invalid={!executablePath.trim()}
                  />
                  {executablePath.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon={<Play size={14} />}
                      aria-label={t("emulators.editor.testLaunch")}
                      title={t("emulators.editor.testLaunch")}
                      onClick={() => void testLaunch()}
                    />
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<FolderOpen size={14} />}
                    onClick={() => void pickExecutable()}
                  >
                    {t("emulators.browseExe")}
                  </Button>
                </div>
              </label>

              <div className="emu-editor__field">
                <div className="emu-editor__field-head">
                  <span>{t("emulators.argumentsTemplate")}</span>
                  <button
                    type="button"
                    className="emu-editor__insert"
                    onClick={() =>
                      setArgumentsTemplate((v) =>
                        `${v}${v && !v.endsWith(" ") ? " " : ""}%ROM%`
                      )
                    }
                    title={t("emulators.editor.insertRom")}
                  >
                    + %ROM%
                  </button>
                </div>
                <input
                  className="emu-editor__mono"
                  value={argumentsTemplate}
                  aria-label={t("emulators.argumentsTemplate")}
                  onChange={(e) => setArgumentsTemplate(e.target.value)}
                  placeholder='"%ROM%"'
                />
                <div className="emu-editor__presets">
                  {ARG_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`emu-editor__preset${argumentsTemplate === preset ? " is-active" : ""}`}
                      onClick={() => setArgumentsTemplate(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <small className="emu-editor__hint">{t("emulators.argumentsHint")}</small>
                <div className="emu-editor__preview">
                  <span>{t("emulators.editor.commandPreview")}</span>
                  <code title={preview}>{preview}</code>
                </div>
              </div>

              {isLinuxHost && linuxPresets.length > 0 && (
                <div className="emu-editor__field">
                  <span>{t("emulators.linux.launchCommands")}</span>
                  <div className="emu-editor__presets">
                    {linuxPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="emu-editor__preset"
                        onClick={() => {
                          setExecutablePath(preset.executablePath);
                          setArgumentsTemplate(preset.argumentsTemplate);
                        }}
                      >
                        {t(preset.labelKey)}
                      </button>
                    ))}
                  </div>
                  <small className="emu-editor__hint">{t("emulators.linux.launchHint")}</small>
                </div>
              )}
            </section>
          </div>

          <aside className="emu-editor__side">
            <section className="emu-editor__section">
              <header className="emu-editor__section-head">
                <span className="emu-editor__section-icon"><HardDrive size={15} /></span>
                <div>
                  <h3>{t("emulators.editor.section.library")}</h3>
                  <p>{t("emulators.editor.romFolderHint")}</p>
                </div>
              </header>

              <label className="emu-editor__field">
                <span>
                  {t("emulators.romFolder")}
                  <em className="emu-editor__req">{t("emulators.editor.required")}</em>
                </span>
                <div className="emu-editor__path">
                  <input
                    value={romFolder}
                    onChange={(e) => setRomFolder(e.target.value)}
                    placeholder={isLinuxHost ? "/home/user/ROMs/gamecube" : "C:\\roms\\gamecube"}
                    aria-invalid={!romFolder.trim()}
                  />
                  {romFolder.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon={<FolderOpen size={14} />}
                      aria-label={t("emulators.openFolder")}
                      title={t("emulators.openFolder")}
                      onClick={() => void openFolder(romFolder)}
                    />
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<FolderOpen size={14} />}
                    onClick={() => void pickFolder()}
                  >
                    {t("emulators.browseFolder")}
                  </Button>
                </div>
              </label>

              <label className="emu-editor__toggle">
                <input
                  type="checkbox"
                  checked={autoScan}
                  onChange={(e) => setAutoScan(e.target.checked)}
                />
                <span>
                  <strong>{t("emulators.editor.autoScan")}</strong>
                  <small>{t("emulators.editor.autoScanHint")}</small>
                </span>
              </label>

              {!isEdit && (
                <label className="emu-editor__toggle">
                  <input
                    type="checkbox"
                    checked={scanAfter}
                    onChange={(e) => setScanAfter(e.target.checked)}
                  />
                  <span>
                    <strong>{t("emulators.editor.scanAfter")}</strong>
                    <small>{t("emulators.editor.scanAfterHint")}</small>
                  </span>
                </label>
              )}
            </section>

            <section className="emu-editor__section">
              <header className="emu-editor__section-head">
                <span className="emu-editor__section-icon"><Terminal size={15} /></span>
                <div>
                  <h3>{t("emulators.editor.section.firmware")}</h3>
                  <p>{t("emulators.bios.optional")}</p>
                </div>
              </header>

              <label className="emu-editor__field">
                <span>{t("emulators.bios.title")}</span>
                <div className="emu-editor__path">
                  <input
                    value={biosFolder}
                    onChange={(e) => setBiosFolder(e.target.value)}
                    placeholder={
                      isLinuxHost ? "/usr/share/dolphin-emu/Sys/GC" : "C:\\emu\\dolphin\\Sys\\GC"
                    }
                  />
                  {biosFolder.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon={<FolderOpen size={14} />}
                      aria-label={t("emulators.openFolder")}
                      title={t("emulators.openFolder")}
                      onClick={() => void openFolder(biosFolder)}
                    />
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<FolderOpen size={14} />}
                    onClick={() => void pickDir(setBiosFolder, t("emulators.bios.title"))}
                  >
                    {t("emulators.browseFolder")}
                  </Button>
                </div>
                <small className="emu-editor__hint">{t("emulators.bios.docsHint")}</small>
              </label>

              <label className="emu-editor__field">
                <span>{t("emulators.saves.title")}</span>
                <div className="emu-editor__path">
                  <input
                    value={savesFolder}
                    onChange={(e) => setSavesFolder(e.target.value)}
                    placeholder={
                      isLinuxHost
                        ? "/home/user/.local/share/dolphin-emu/GC/USA/Card A"
                        : "C:\\emu\\dolphin\\User\\GC\\USA\\Card A"
                    }
                  />
                  {savesFolder.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon={<FolderOpen size={14} />}
                      aria-label={t("emulators.openFolder")}
                      title={t("emulators.openFolder")}
                      onClick={() => void openFolder(savesFolder)}
                    />
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<FolderOpen size={14} />}
                    onClick={() => void pickDir(setSavesFolder, t("emulators.saves.title"))}
                  >
                    {t("emulators.browseFolder")}
                  </Button>
                </div>
                <small className="emu-editor__hint">{t("emulators.saves.folderHint")}</small>
              </label>
            </section>

            <section className="emu-editor__section">
              <header className="emu-editor__section-head">
                <span className="emu-editor__section-icon"><StickyNote size={15} /></span>
                <div>
                  <h3>{t("emulators.notes")}</h3>
                  <p>{t("emulators.editor.notesHint")}</p>
                </div>
              </header>
              <label className="emu-editor__field">
                <textarea
                  value={notes}
                  aria-label={t("emulators.notes")}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={t("emulators.editor.notesPlaceholder")}
                />
              </label>
            </section>
          </aside>
        </div>

        <footer className="emu-editor__foot">
          <div
            className={`emu-editor__validation${complete ? " is-ready" : ""}`}
            role="status"
            aria-live="polite"
          >
            {complete ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>
              {complete
                ? t("emulators.editor.ready")
                : t("emulators.editor.missingList", { fields: missing.join(", ") })}
            </span>
          </div>
          <div className="emu-editor__foot-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              leftIcon={<Save size={16} />}
              onClick={() => void handleSave()}
              isLoading={saving}
              disabled={!complete}
              title={complete ? undefined : t("emulators.editor.missingFields", { count: missing.length })}
            >
              {t("emulators.editor.save")}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
