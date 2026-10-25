// Guide overlay — the console "home button" flyout.
//
// Opened from the Menu/Start button, the top-bar guide icon or the G
// key. It is the fastest way around the shell: jump to any section,
// flip the layout preset or theme, check controller status, resume or
// stop the running game, and leave Big Screen Mode.
//
// Contract with the focus engine: the panel carries
// `data-bigscreen-overlay="true"` so spatial navigation, A activation
// and B/Escape stay inside it; `data-arrow-nav="true"` additionally
// lets the shell route keyboard arrows through the same engine while
// it is open.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { useGames } from "../../../context/GameContext";
import { useGamepad } from "../../../hooks/GamepadProvider";
import { useBigScreen } from "../../../context/BigScreenContext";
import { useTheme } from "../../../context/ThemeContext";
import {
  useBigScreenPrefs,
  useActivePreset,
} from "../../../context/BigScreenPrefsContext";
import { useSettings } from "../../../context/SettingsContext";
import { PRIMARY_SECTIONS, sectionForPath } from "../../../bigscreen/registry";
import { nextPreset } from "../../../bigscreen/presets";
import { useFocusable } from "../../../hooks/useFocusable";
import { formatLastPlayedLocalized } from "../bigscreenFormat";

/** A section shortcut tile inside the guide. Extracted so
 *  `useFocusable` is called from a component, not a loop. */
function GuideTile({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      {...useFocusable(onClick)}
      type="button"
      className="bs-guide-tile"
      data-active={active ? "true" : undefined}
      onClick={onClick}
    >
      <span className="bs-guide-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="bs-guide-tile-label">{label}</span>
    </button>
  );
}

interface GuideRowProps {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  tone?: "default" | "danger";
}

function GuideRow({ icon, label, value, onClick, tone = "default" }: GuideRowProps) {
  const focusProps = useFocusable(onClick);

  return (
    <button
      {...focusProps}
      type="button"
      className="bs-guide-row"
      data-tone={tone === "danger" ? "danger" : undefined}
      onClick={onClick}
    >
      {icon ? (
        <span className="bs-guide-row-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="bs-guide-row-label">{label}</span>
      {value ? <span className="bs-guide-row-value">{value}</span> : null}
    </button>
  );
}

interface BigScreenGuideProps {
  open: boolean;
  onClose: () => void;
  onOpenQuickSettings: () => void;
}

export default function BigScreenGuide({
  open,
  onClose,
  onOpenQuickSettings,
}: BigScreenGuideProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const gamepad = useGamepad();
  const { games, runningGameIds, launchGame, forceCloseGame } = useGames();
  const { requestExit } = useBigScreen();
  const { currentTheme, setTheme, themes } = useTheme();
  const { prefs, setPreset } = useBigScreenPrefs();
  const preset = useActivePreset();
  const { reduceMotion, setReduceMotion, animatedMediaEnabled, setAnimatedMediaEnabled } =
    useSettings();
  const activePath = window.location.hash.replace(/^#/, "") || "/home";
  const [now, setNow] = useState(() => new Date());
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      if (panelRef.current) gamepad.focusFirst(panelRef.current);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, gamepad.focusFirst]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [open]);

  // Escape closes the flyout (B is dispatched as Escape by the engine).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  const running = useMemo(
    () => games.filter((game) => runningGameIds.includes(game.id)),
    [games, runningGameIds],
  );

  const resumeGame = useMemo(() => {
    if (running.length) return null;
    let latest: { id: string; lastPlayed?: number } | null = null;
    for (const game of games) {
      if (!game.lastPlayed) continue;
      if (!latest || (game.lastPlayed ?? 0) > (latest.lastPlayed ?? 0)) {
        latest = { id: game.id, lastPlayed: game.lastPlayed };
      }
    }
    return latest ? games.find((game) => game.id === latest!.id) ?? null : null;
  }, [games, running.length]);

  if (!open) return null;

  const clock = new Intl.DateTimeFormat(language, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const runningGame = running[0];
  const themeIndex = themes.findIndex((theme) => theme.id === currentTheme);
  const nextTheme = themes[(themeIndex + 1) % Math.max(themes.length, 1)];

  return (
    <div className="bs-guide-layer">
      <div className="bs-guide-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="bs-guide"
        role="dialog"
        aria-modal="true"
        aria-label={t("bigscreen.guide.title")}
        data-bigscreen-overlay="true"
        data-arrow-nav="true"
      >
        <header className="bs-guide-head">
          <span className="bs-guide-time">{clock}</span>
          <span className="bs-guide-status" data-connected={gamepad.connected ? "true" : undefined}>
            <span className="bs-guide-status-dot" aria-hidden="true" />
            {t(
              gamepad.connected
                ? "bigscreen.guide.padConnected"
                : "bigscreen.guide.padMissing",
            )}
          </span>
        </header>

        <div className="bs-guide-body">
          <section className="bs-guide-group" aria-label={t("bigscreen.guide.sections")}>
            <h2 className="bs-guide-group-title">{t("bigscreen.guide.sections")}</h2>
            <div className="bs-guide-sections">
              {PRIMARY_SECTIONS.map((section) => (
                <GuideTile
                  key={section.id}
                  label={t(section.labelKey)}
                  icon={section.icon}
                  active={sectionForPath(activePath) === section.id}
                  onClick={() => go(section.path)}
                />
              ))}
            </div>
          </section>

          <section className="bs-guide-group" aria-label={t("bigscreen.guide.quickSettings")}>
            <h2 className="bs-guide-group-title">
              {t("bigscreen.guide.quickSettings")}
            </h2>
            <GuideRow
              label={t("bigscreen.quickSettings.layout")}
              value={t(preset.labelKey)}
              onClick={() => setPreset(nextPreset(prefs.preset))}
            />
            <GuideRow
              label={t("bigscreen.quickSettings.theme")}
              value={nextTheme ? nextTheme.meta.name : currentTheme}
              onClick={() => nextTheme && setTheme(nextTheme.id)}
            />
            <GuideRow
              label={t("bigscreen.quickSettings.reduceMotion")}
              value={t(
                reduceMotion ? "bigscreen.quickSettings.on" : "bigscreen.quickSettings.off",
              )}
              onClick={() => setReduceMotion(!reduceMotion)}
            />
            <GuideRow
              label={t("bigscreen.quickSettings.animatedArt")}
              value={t(
                animatedMediaEnabled
                  ? "bigscreen.quickSettings.on"
                  : "bigscreen.quickSettings.off",
              )}
              onClick={() => setAnimatedMediaEnabled(!animatedMediaEnabled)}
            />
            <GuideRow
              label={t("bigscreen.quickSettings.title")}
              onClick={() => {
                onClose();
                onOpenQuickSettings();
              }}
            />
          </section>

          <section className="bs-guide-group" aria-label={t("bigscreen.guide.actions")}>
            <h2 className="bs-guide-group-title">{t("bigscreen.guide.actions")}</h2>
            {runningGame ? (
              <>
                <GuideRow
                  label={runningGame.name}
                  value={t("bigscreen.guide.running")}
                  onClick={() => go(`/library/${runningGame.id}`)}
                />
                <GuideRow
                  label={t("bigscreen.guide.stopGame")}
                  tone="danger"
                  onClick={() => void forceCloseGame(runningGame)}
                />
              </>
            ) : resumeGame ? (
              <GuideRow
                label={t("bigscreen.guide.resume")}
                value={`${resumeGame.name} · ${formatLastPlayedLocalized(resumeGame.lastPlayed ?? 0, t)}`}
                onClick={() => {
                  onClose();
                  launchGame(resumeGame);
                }}
              />
            ) : null}
            <GuideRow
              label={t("nav.downloads")}
              onClick={() => go("/downloads")}
            />
            <GuideRow
              label={t("nav.storage")}
              onClick={() => go("/storage")}
            />
            <GuideRow
              label={t("bigscreen.guide.exit")}
              tone="danger"
              onClick={() => {
                onClose();
                requestExit();
              }}
            />
          </section>
        </div>

        <footer className="bs-guide-foot" aria-hidden="true">
          <span className="bs-hint">
            <b className="bs-key">B</b>
            {t("bigscreen.guide.close")}
          </span>
          <span className="bs-hint">
            <b className="bs-key">A</b>
            {t("bigscreen.shell.selectHint")}
          </span>
        </footer>
      </aside>
    </div>
  );
}
