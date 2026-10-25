import { Gamepad2, Shield, SlidersHorizontal, X } from "lucide-react";
import { COMMON_LAUNCH_ARGS } from "../editConstants";
import { Field, SectionHeader, SettingCard, ToggleCard } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function OptionsSection() {
  const {
    t,
    game,
    isWindowsHost,
    editLaunchArguments,
    setEditLaunchArguments,
    appendLaunchArg,
    editRunAsAdmin,
    setEditRunAsAdmin,
    editShowSteamLaunchSelection,
    setEditShowSteamLaunchSelection,
    steamLaunchOptions,
    steamLaunchListLabel,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  return (
    <section className="edit-section" aria-labelledby="edit-section-options">
      <SectionHeader
        id="edit-section-options"
        title={t("edit.section.options")}
        description={t("edit.section.optionsDesc")}
        changed={dirtyBySection.options}
        onReset={() => resetSection("options")}
      />

      <SettingCard
        icon={<SlidersHorizontal size={17} aria-hidden="true" />}
        title={t("edit.label.launchArguments")}
        description={t("edit.launchArgsHint")}
      >
        <Field htmlFor="edit-launch-arguments">
          <div className="edit-args-wrapper">
            <span className="edit-args-prefix" aria-hidden="true">
              &gt;
            </span>
            <input
              id="edit-launch-arguments"
              className="edit-input edit-input--mono edit-args-input"
              type="text"
              value={editLaunchArguments}
              onChange={(event) => setEditLaunchArguments(event.target.value)}
              placeholder="-windowed -novid -dx11"
            />
            {editLaunchArguments && (
              <button
                type="button"
                className="edit-input-clear"
                onClick={() => setEditLaunchArguments("")}
                title={t("edit.clearArguments")}
                aria-label={t("edit.clearArguments")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </Field>

        <div className="edit-chips-block">
          <span className="edit-chips-label">{t("edit.quickPresets")}</span>
          <div className="edit-chip-row">
            {COMMON_LAUNCH_ARGS.map((arg) => {
              const active = editLaunchArguments.includes(arg.label);
              return (
                <button
                  key={arg.label}
                  type="button"
                  className={`edit-chip edit-chip--button${active ? " is-active" : ""}`}
                  onClick={() => appendLaunchArg(arg.label)}
                  title={t(arg.descKey)}
                  aria-pressed={active}
                >
                  <code>{arg.label}</code>
                  <span>{t(arg.descKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingCard>

      <div className="edit-card-grid">
        {isWindowsHost && (
          <ToggleCard
            id="edit-run-as-admin"
            icon={<Shield size={17} aria-hidden="true" />}
            title={t("edit.runAsAdmin")}
            description={t("edit.runAsAdminHint")}
            checked={editRunAsAdmin}
            onChange={setEditRunAsAdmin}
            badge={
              <span className={`edit-badge${editRunAsAdmin ? " is-on" : ""}`}>
                {editRunAsAdmin ? t("edit.badge.elevated") : t("edit.badge.normal")}
              </span>
            }
          />
        )}

        {game.platform === "Steam" && (
          <ToggleCard
            id="edit-steam-launch-selection"
            icon={<Gamepad2 size={17} aria-hidden="true" />}
            title={t("edit.showSteamLaunchSelection")}
            description={t("edit.showSteamLaunchSelectionHint")}
            checked={editShowSteamLaunchSelection}
            onChange={setEditShowSteamLaunchSelection}
            badge={
              <span className={`edit-badge${editShowSteamLaunchSelection ? " is-on" : ""}`}>
                {editShowSteamLaunchSelection ? t("edit.badge.enabled") : t("edit.badge.auto")}
              </span>
            }
          >
            {steamLaunchOptions && steamLaunchOptions.length >= 2 && (
              <p className="edit-muted-note">
                {t("edit.steamOptionsDetected", {
                  count: steamLaunchOptions.length,
                  list: steamLaunchListLabel,
                })}
              </p>
            )}
          </ToggleCard>
        )}
      </div>
    </section>
  );
}
