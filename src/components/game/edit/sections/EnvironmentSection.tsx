import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../../ui";
import { Disclosure } from "../../../ui";
import {
  EmptyState,
  Field,
  SectionHeader,
  SettingCard,
} from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function EnvironmentSection() {
  const {
    t,
    globalCompatSettings,
    compatEnvPairs,
    setCompatEnvPairs,
    compatDllPairs,
    setCompatDllPairs,
    excludedGlobalEnv,
    excludedGlobalDlls,
    handleToggleExcludeGlobalEnv,
    handleToggleExcludeGlobalDll,
    handleRemoveFromGlobalEnv,
    handleRemoveFromGlobalDll,
    compatPreLaunch,
    setCompatPreLaunch,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  const globalEnv = globalCompatSettings?.customEnvironmentVariables ?? {};
  const globalDlls = globalCompatSettings?.customDllOverrides ?? {};
  const globalEnvKeys = Object.keys(globalEnv);
  const globalDllKeys = Object.keys(globalDlls);

  return (
    <section className="edit-section" aria-labelledby="edit-section-environment">
      <SectionHeader
        id="edit-section-environment"
        title={t("edit.section.environment")}
        description={t("edit.section.environmentDesc")}
        changed={dirtyBySection.environment}
        onReset={() => resetSection("environment")}
      />

      <Disclosure>
      <SettingCard
        title={t("gameEdit.compatibility.inheritedGlobalEnv")}
        description={t("gameEdit.compatibility.inheritedGlobalEnvDesc")}
        meta={
          globalEnvKeys.length > 0 ? (
            <span className="edit-count-badge">{globalEnvKeys.length}</span>
          ) : undefined
        }
      >
        {globalEnvKeys.length === 0 ? (
          <EmptyState text={t("gameEdit.compatibility.noGlobalEnv")} />
        ) : (
          <div className="edit-inherited-list">
            {globalEnvKeys.map((key) => {
              const excluded = excludedGlobalEnv.includes(key);
              return (
                <div
                  key={key}
                  className={`edit-inherited-row${excluded ? " is-excluded" : ""}`}
                >
                  <div className="edit-inherited-info">
                    <code>{key}</code>
                    <span>= {String(globalEnv[key] || '""')}</span>
                    {excluded && (
                      <span className="edit-chip edit-chip--warning">
                        {t("gameEdit.compatibility.excluded")}
                      </span>
                    )}
                  </div>
                  <div className="edit-inherited-actions">
                    <Button
                      variant={excluded ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => handleToggleExcludeGlobalEnv(key)}
                      title={
                        excluded
                          ? t("gameEdit.compatibility.includeForGame")
                          : t("gameEdit.compatibility.excludeForGame")
                      }
                    >
                      {excluded
                        ? t("gameEdit.compatibility.restoreForGame")
                        : t("gameEdit.compatibility.excludeForGame")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => handleRemoveFromGlobalEnv(key)}
                      aria-label={t("gameEdit.compatibility.removeFromGlobal")}
                      title={t("gameEdit.compatibility.removeFromGlobal")}
                      leftIcon={<Trash2 size={14} />}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingCard>

      <SettingCard
        id="compat-env-vars"
        title={t("gameEdit.compatibility.envVars")}
        description={t("gameEdit.compatibility.envVarsDesc")}
        meta={
          compatEnvPairs.length > 0 ? (
            <span className="edit-count-badge">{compatEnvPairs.length}</span>
          ) : undefined
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setCompatEnvPairs([...compatEnvPairs, { key: "", value: "" }])
            }
            leftIcon={<Plus size={14} />}
          >
            {t("gameEdit.compatibility.addEnv")}
          </Button>
        }
      >
        {compatEnvPairs.length === 0 ? (
          <EmptyState text={t("gameEdit.compatibility.noEnv")} />
        ) : (
          <div className="edit-pair-list">
            {compatEnvPairs.map((pair, index) => (
              <div key={index} className="edit-pair-row">
                <input
                  type="text"
                  className="edit-input edit-input--mono"
                  placeholder={t("edit.placeholder.envKey")}
                  value={pair.key}
                  onChange={(event) => {
                    const next = [...compatEnvPairs];
                    next[index] = { ...next[index], key: event.target.value };
                    setCompatEnvPairs(next);
                  }}
                  aria-label={t("edit.placeholder.envKey")}
                />
                <input
                  type="text"
                  className="edit-input edit-input--mono"
                  placeholder={t("edit.placeholder.envValue")}
                  value={pair.value}
                  onChange={(event) => {
                    const next = [...compatEnvPairs];
                    next[index] = { ...next[index], value: event.target.value };
                    setCompatEnvPairs(next);
                  }}
                  aria-label={t("edit.placeholder.envValue")}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() =>
                    setCompatEnvPairs(compatEnvPairs.filter((_, i) => i !== index))
                  }
                  aria-label={t("edit.removeVariable")}
                  title={t("edit.removeVariable")}
                  leftIcon={<Trash2 size={14} />}
                />
              </div>
            ))}
          </div>
        )}
      </SettingCard>

      <SettingCard
        title={t("gameEdit.compatibility.inheritedGlobalDll")}
        description={t("gameEdit.compatibility.inheritedGlobalDllDesc")}
        meta={
          globalDllKeys.length > 0 ? (
            <span className="edit-count-badge">{globalDllKeys.length}</span>
          ) : undefined
        }
      >
        {globalDllKeys.length === 0 ? (
          <EmptyState text={t("gameEdit.compatibility.noGlobalDll")} />
        ) : (
          <div className="edit-inherited-list">
            {globalDllKeys.map((dll) => {
              const excluded = excludedGlobalDlls.includes(dll);
              return (
                <div
                  key={dll}
                  className={`edit-inherited-row${excluded ? " is-excluded" : ""}`}
                >
                  <div className="edit-inherited-info">
                    <code>{dll}.dll</code>
                    <span>({String(globalDlls[dll])})</span>
                    {excluded && (
                      <span className="edit-chip edit-chip--warning">
                        {t("gameEdit.compatibility.excluded")}
                      </span>
                    )}
                  </div>
                  <div className="edit-inherited-actions">
                    <Button
                      variant={excluded ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => handleToggleExcludeGlobalDll(dll)}
                      title={
                        excluded
                          ? t("gameEdit.compatibility.includeForGame")
                          : t("gameEdit.compatibility.excludeForGame")
                      }
                    >
                      {excluded
                        ? t("gameEdit.compatibility.restoreForGame")
                        : t("gameEdit.compatibility.excludeForGame")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => handleRemoveFromGlobalDll(dll)}
                      aria-label={t("gameEdit.compatibility.removeFromGlobal")}
                      title={t("gameEdit.compatibility.removeFromGlobal")}
                      leftIcon={<Trash2 size={14} />}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingCard>

      <SettingCard
        id="compat-dlls"
        title={t("gameEdit.compatibility.dllOverrides")}
        description={t("gameEdit.compatibility.dllOverridesDesc")}
        meta={
          compatDllPairs.length > 0 ? (
            <span className="edit-count-badge">{compatDllPairs.length}</span>
          ) : undefined
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setCompatDllPairs([...compatDllPairs, { dll: "", mode: "n,b" }])
            }
            leftIcon={<Plus size={14} />}
          >
            {t("gameEdit.compatibility.addDll")}
          </Button>
        }
      >
        {compatDllPairs.length === 0 ? (
          <EmptyState text={t("gameEdit.compatibility.noDll")} />
        ) : (
          <div className="edit-pair-list">
            {compatDllPairs.map((pair, index) => (
              <div key={index} className="edit-pair-row">
                <input
                  type="text"
                  className="edit-input edit-input--mono"
                  placeholder={t("edit.placeholder.dll")}
                  value={pair.dll}
                  onChange={(event) => {
                    const next = [...compatDllPairs];
                    next[index] = { ...next[index], dll: event.target.value };
                    setCompatDllPairs(next);
                  }}
                  aria-label={t("edit.placeholder.dll")}
                />
                <select
                  className="edit-input"
                  value={pair.mode}
                  onChange={(event) => {
                    const next = [...compatDllPairs];
                    next[index] = { ...next[index], mode: event.target.value };
                    setCompatDllPairs(next);
                  }}
                  aria-label={t("edit.dllMode")}
                >
                  <option value="n,b">{t("edit.dllMode.nativeBuiltin")}</option>
                  <option value="b,n">{t("edit.dllMode.builtinNative")}</option>
                  <option value="n">{t("edit.dllMode.native")}</option>
                  <option value="b">{t("edit.dllMode.builtin")}</option>
                  <option value="">{t("edit.dllMode.disabled")}</option>
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() =>
                    setCompatDllPairs(compatDllPairs.filter((_, i) => i !== index))
                  }
                  aria-label={t("edit.removeOverride")}
                  title={t("edit.removeOverride")}
                  leftIcon={<Trash2 size={14} />}
                />
              </div>
            ))}
          </div>
        )}
      </SettingCard>

      <SettingCard
        id="compat-pre-launch"
        title={t("gameEdit.compatibility.preLaunchCommand")}
        description={t("gameEdit.compatibility.preLaunchCommandDesc")}
      >
        <Field htmlFor="compat-pre-launch-input">
          <input
            id="compat-pre-launch-input"
            type="text"
            className="edit-input edit-input--mono"
            value={compatPreLaunch}
            onChange={(event) => setCompatPreLaunch(event.target.value)}
            placeholder={t("edit.placeholder.preLaunchWrapper")}
          />
        </Field>
      </SettingCard>
      </Disclosure>
    </section>
  );
}
