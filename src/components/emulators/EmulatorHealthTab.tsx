// Health tab: one read-only pass over the emulation library with explicit,
// safe fixes. Nothing here deletes a file on its own — unlink removes the
// library row, and the file stays where it is.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Copy,
  FolderSearch,
  Info,
  RefreshCw,
  Sparkles,
  Unlink,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, Panel } from "../ui";
import type {
  Emulator,
  EmulatorHealthFinding,
  EmulatorHealthReport,
  RomEnrichProgress,
  RomEnrichSummary,
} from "../../types/emulator";
import { formatBytesShort } from "../../types/download";

interface HealthTabProps {
  emulators: Emulator[];
  selected: Emulator | null;
  onEditEmulator: (emulator: Emulator) => void;
  onUnlinkRom: (gameId: string) => Promise<void> | void;
  onRecalcSizes: (emulatorId: string) => Promise<void> | void;
}

const KIND_ICON: Record<string, typeof AlertTriangle> = {
  missing_executable: CircleAlert,
  missing_rom_folder: FolderSearch,
  missing_rom: CircleAlert,
  empty_rom: AlertTriangle,
  missing_bios: AlertTriangle,
  bios_unconfigured: Info,
  unknown_size: Info,
  duplicate_rom: Copy,
};

export default function EmulatorHealthTab({
  emulators,
  selected,
  onEditEmulator,
  onUnlinkRom,
  onRecalcSizes,
}: HealthTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [report, setReport] = useState<EmulatorHealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<RomEnrichProgress | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const scan = useCallback(
    async (deepScan = false) => {
      setBusy(true);
      try {
        const next = await invoke<EmulatorHealthReport>("emulator_health_scan", {
          deep: deepScan,
        });
        if (mounted.current) {
          setReport(next);
          setDeep(deepScan);
        }
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    void scan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<RomEnrichProgress>("rom-enrich-progress", (event) => {
      if (!disposed) setEnrichProgress(event.payload);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const enrich = useCallback(async () => {
    if (!selected) return;
    setEnriching(true);
    setEnrichProgress(null);
    try {
      const summary = await invoke<RomEnrichSummary>("enrich_emulator_metadata", {
        emulatorId: selected.id,
        onlyMissing: true,
      });
      showToast(
        t("emulators.health.enrichDone", {
          matched: summary.matched,
          skipped: summary.skipped,
          failed: summary.failed,
        }),
        summary.failed > 0 ? "warning" : "success"
      );
      await scan(deep);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      if (mounted.current) {
        setEnriching(false);
        setEnrichProgress(null);
      }
    }
  }, [selected, scan, deep, showToast, t]);

  const findings = report?.findings ?? [];
  const errors = report?.errors ?? 0;
  const warnings = report?.warnings ?? 0;

  const renderFix = (finding: EmulatorHealthFinding) => {
    if (finding.fix === "edit_emulator" && finding.emulatorId) {
      const emu = emulators.find((e) => e.id === finding.emulatorId);
      return emu ? (
        <Button variant="secondary" size="sm" onClick={() => onEditEmulator(emu)}>
          {t("emulators.health.fixEdit")}
        </Button>
      ) : null;
    }
    if (finding.fix === "unlink_rom" && finding.gameId) {
      return (
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Unlink size={13} />}
          onClick={async () => {
            await onUnlinkRom(finding.gameId!);
            await scan(deep);
          }}
        >
          {t("emulators.health.fixUnlink")}
        </Button>
      );
    }
    if (finding.fix === "recalc_sizes" && finding.emulatorId) {
      return (
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw size={13} />}
          onClick={async () => {
            await onRecalcSizes(finding.emulatorId!);
            await scan(deep);
          }}
        >
          {t("emulators.health.fixRecalc")}
        </Button>
      );
    }
    if (finding.fix === "review_duplicates") {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExpanded(expanded === finding.id ? null : finding.id)}
        >
          {expanded === finding.id ? t("emulators.health.hideCopies") : t("emulators.health.review")}
        </Button>
      );
    }
    return null;
  };

  return (
    <div className="emu-wb-tab-body emu-wb-health">
      <div className="emu-wb-health-band">
        <div className={`emu-wb-health-metric${errors > 0 ? " is-error" : " is-ok"}`}>
          <span className="emu-wb-health-metric-value">{errors}</span>
          <span className="emu-wb-health-metric-label">{t("emulators.health.errors")}</span>
        </div>
        <div className={`emu-wb-health-metric${warnings > 0 ? " is-warning" : " is-ok"}`}>
          <span className="emu-wb-health-metric-value">{warnings}</span>
          <span className="emu-wb-health-metric-label">{t("emulators.health.warnings")}</span>
        </div>
        <div className="emu-wb-health-metric">
          <span className="emu-wb-health-metric-value">
            {report ? formatBytesShort(report.reclaimableBytes) : "—"}
          </span>
          <span className="emu-wb-health-metric-label">{t("emulators.health.reclaimable")}</span>
        </div>
        <div className="emu-wb-health-metric">
          <span className="emu-wb-health-metric-value">{report?.duplicateGroups ?? 0}</span>
          <span className="emu-wb-health-metric-label">{t("emulators.health.duplicates")}</span>
        </div>
        <div className="emu-wb-health-band-actions">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            isLoading={busy}
            onClick={() => void scan(deep)}
          >
            {t("emulators.health.rescan")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Zap size={14} />}
            isLoading={busy && !deep}
            onClick={() => void scan(true)}
            title={t("emulators.health.deepHint")}
          >
            {t("emulators.health.deepScan")}
          </Button>
        </div>
      </div>

      {report && (
        <p className="emu-wb-health-meta">
          {t("emulators.health.summary", {
            systems: report.systems,
            roms: report.roms,
          })}
          {deep ? ` · ${t("emulators.health.deepDone")}` : ""}
        </p>
      )}

      <Panel
        tone="plain"
        heading={t("emulators.health.findings")}
        icon={<AlertTriangle size={16} />}
        actions={
          findings.length > 0 ? (
            <span className="emu-wb-health-count">{findings.length}</span>
          ) : null
        }
      >
        {report === null ? (
          <p className="emu-wb-hint">{t("emulators.health.scanning")}</p>
        ) : findings.length === 0 ? (
          <div className="emu-wb-health-clean">
            <CheckCircle2 size={26} />
            <div>
              <strong>{t("emulators.health.cleanTitle")}</strong>
              <p>{t("emulators.health.cleanDesc")}</p>
            </div>
          </div>
        ) : (
          <ul className="emu-wb-health-list">
            {findings.map((finding) => {
              const Icon = KIND_ICON[finding.kind] ?? Info;
              const isDuplicate = finding.kind === "duplicate_rom";
              return (
                <li
                  key={finding.id}
                  className={`emu-wb-health-row is-${finding.severity}`}
                >
                  <span className="emu-wb-health-icon" aria-hidden>
                    <Icon size={15} />
                  </span>
                  <div className="emu-wb-health-info">
                    <div className="emu-wb-health-title">
                      <strong>{t(`emulators.health.kind.${finding.kind}`)}</strong>
                      <span className="emu-wb-health-scope">
                        {finding.emulatorName ?? t("emulators.health.libraryScope")}
                      </span>
                    </div>
                    <p>
                      {finding.gameName ? `${finding.gameName} — ` : ""}
                      {finding.path ?? finding.message}
                    </p>
                    {finding.missingFiles.length > 0 && (
                      <p className="emu-wb-health-files">{finding.missingFiles.join(", ")}</p>
                    )}

                    {isDuplicate && expanded === finding.id && (
                      <div className="emu-wb-health-copies">
                        {(finding.paths ?? []).map((path, index) => {
                          const gameId = finding.gameIds?.[index];
                          return (
                            <div key={path} className="emu-wb-health-copy">
                              <span className="emu-mono" title={path}>{path}</span>
                              {gameId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  leftIcon={<Unlink size={12} />}
                                  onClick={async () => {
                                    await onUnlinkRom(gameId);
                                    await scan(deep);
                                  }}
                                >
                                  {t("emulators.health.unlinkCopy")}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {finding.bytes ? (
                    <span className="emu-wb-health-bytes">{formatBytesShort(finding.bytes)}</span>
                  ) : null}
                  <div className="emu-wb-health-fix">{renderFix(finding)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        tone="raised"
        heading={t("emulators.health.enrichTitle")}
        eyebrow={selected?.name ?? t("emulators.health.enrichScope")}
        icon={<Sparkles size={16} />}
      >
        <p className="emu-wb-hint">{t("emulators.health.enrichDesc")}</p>
        <div className="emu-wb-health-enrich">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Sparkles size={14} />}
            isLoading={enriching}
            disabled={!selected}
            onClick={() => void enrich()}
          >
            {enriching ? t("emulators.health.enriching") : t("emulators.health.enrichCta")}
          </Button>
          {enrichProgress && (
            <div className="emu-wb-health-progress">
              <span className="emu-wb-health-progress-track">
                <span
                  className="emu-wb-health-progress-fill"
                  style={{
                    width: `${enrichProgress.total > 0 ? (enrichProgress.done / enrichProgress.total) * 100 : 0}%`,
                  }}
                />
              </span>
              <span>
                {enrichProgress.done}/{enrichProgress.total} · {enrichProgress.title}
              </span>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
