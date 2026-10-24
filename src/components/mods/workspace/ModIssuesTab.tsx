// Conflicts & integrity tab. Two questions in one place: which mods ship the
// same file (and which one wins), and which installed mods cannot work at all
// (folder gone, empty install, duplicate folder name).

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileWarning,
  FolderOpen,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { Button, Panel } from "../../ui";
import type { Game } from "../../../types/game";
import type {
  GameModsPayload,
  ModConflict,
  ModHealthFinding,
  ModHealthReport,
} from "../../../types/mods";

interface IssuesTabProps {
  game: Game;
  conflicts: ModConflict[];
  health: ModHealthReport | null;
  onRefresh: () => void;
}

const SEVERITY_ICON = {
  error: AlertTriangle,
  warning: FileWarning,
  info: Copy,
} as const;

export default function ModIssuesTab({ game, conflicts, health, onRefresh }: IssuesTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadNames = useCallback(async () => {
    try {
      const payload = await invoke<GameModsPayload>("mods_list", { gameId: game.id });
      const map: Record<string, string> = {};
      for (const mod of payload.mods) map[mod.id] = mod.name;
      setNames(map);
    } catch {
      // Names are decoration; ids still identify the rows.
    }
  }, [game.id]);

  useEffect(() => {
    void loadNames();
  }, [loadNames]);

  const removeFromLibrary = useCallback(
    async (finding: ModHealthFinding) => {
      setBusyId(finding.id);
      try {
        await invoke("mods_unlink", { modId: finding.modId });
        await loadNames();
        onRefresh();
        showToast(t("mods.issues.removed"), "success");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setBusyId(null);
      }
    },
    [loadNames, onRefresh, showToast, t]
  );

  const openFolder = useCallback(
    async (path?: string) => {
      if (!path) return;
      try {
        await invoke("open_folder", { path });
      } catch (err) {
        showToast(String(err), "error");
      }
    },
    [showToast]
  );

  const findings = useMemo(
    () => (health?.findings ?? []).filter((f) => f.severity !== "info" || f.kind === "unlinked_source"),
    [health]
  );

  const nameFor = (id: string) => names[id] ?? id;

  return (
    <div className="mods-tab-body mods-issues">
      <div className="mods-issues-band">
        <div className="mods-issues-metric">
          <span className="mods-issues-metric-value">{conflicts.length}</span>
          <span className="mods-issues-metric-label">{t("mods.issues.conflictFiles")}</span>
        </div>
        <div className={`mods-issues-metric${(health?.errors ?? 0) > 0 ? " is-error" : ""}`}>
          <span className="mods-issues-metric-value">{health?.errors ?? 0}</span>
          <span className="mods-issues-metric-label">{t("mods.issues.errors")}</span>
        </div>
        <div className={`mods-issues-metric${(health?.warnings ?? 0) > 0 ? " is-warning" : ""}`}>
          <span className="mods-issues-metric-value">{health?.warnings ?? 0}</span>
          <span className="mods-issues-metric-label">{t("mods.issues.warnings")}</span>
        </div>
        <div className="mods-issues-band-actions">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={onRefresh}
          >
            {t("mods.issues.rescan")}
          </Button>
        </div>
      </div>

      <Panel
        tone="plain"
        heading={t("mods.issues.integrity")}
        icon={<FileWarning size={16} />}
        actions={<span className="mods-issues-count">{findings.length}</span>}
      >
        {findings.length === 0 ? (
          <div className="mods-issues-clean">
            <CheckCircle2 size={22} />
            <div>
              <strong>{t("mods.issues.cleanTitle")}</strong>
              <p>{t("mods.issues.cleanDesc")}</p>
            </div>
          </div>
        ) : (
          <ul className="mods-issues-list">
            {findings.map((finding) => {
              const Icon = SEVERITY_ICON[finding.severity as keyof typeof SEVERITY_ICON] ?? Copy;
              return (
                <li key={finding.id} className={`mods-issues-row is-${finding.severity}`}>
                  <span className="mods-issues-icon" aria-hidden>
                    <Icon size={15} />
                  </span>
                  <div className="mods-issues-info">
                    <strong>{t(`mods.issues.kind.${finding.kind}`)}</strong>
                    <span>{finding.name}</span>
                    {finding.path && <code title={finding.path}>{finding.path}</code>}
                  </div>
                  <div className="mods-issues-actions">
                    {finding.path && finding.kind !== "missing_path" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        leftIcon={<FolderOpen size={14} />}
                        aria-label={t("mods.issues.openFolder")}
                        title={t("mods.issues.openFolder")}
                        onClick={() => void openFolder(finding.path)}
                      />
                    )}
                    {(finding.kind === "missing_path" || finding.kind === "empty_mod") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        leftIcon={<Trash2 size={14} />}
                        aria-label={t("mods.issues.remove")}
                        title={t("mods.issues.removeHint")}
                        isLoading={busyId === finding.id}
                        onClick={() => void removeFromLibrary(finding)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        tone="plain"
        heading={t("mods.issues.conflicts")}
        icon={<Copy size={16} />}
        actions={<span className="mods-issues-count">{conflicts.length}</span>}
      >
        {conflicts.length === 0 ? (
          <div className="mods-issues-clean">
            <CheckCircle2 size={22} />
            <div>
              <strong>{t("mods.issues.noConflicts")}</strong>
              <p>{t("mods.issues.noConflictsDesc")}</p>
            </div>
          </div>
        ) : (
          <ul className="mods-issues-conflicts">
            {conflicts.map((conflict) => (
              <li key={conflict.relativePath} className="mods-issues-conflict">
                <code title={conflict.relativePath}>{conflict.relativePath}</code>
                <div className="mods-issues-providers">
                  {conflict.modIds.map((id) => (
                    <span
                      key={id}
                      className={`mods-issues-provider${
                        id === conflict.winnerModId ? " is-winner" : ""
                      }`}
                      title={id === conflict.winnerModId ? t("mods.issues.winner") : undefined}
                    >
                      {nameFor(id)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
