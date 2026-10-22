// BIOS status board — one row per emulator with a curated firmware
// requirement table, checked in a single backend pass
// (`check_all_bios_status`). The per-emulator deep check modal still
// owns the detailed file list; this card is the "which systems are
// actually ready to launch" overview, with a one-click guided fix that
// opens the emulator editor on the BIOS folder field.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, RefreshCw, Settings2, ShieldQuestionMark } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import type { BiosBoardEntry, Emulator } from "../../types/emulator";
import { biosBoardStatus, biosBoardTotals } from "./emulatorUi";

interface EmulatorBiosBoardProps {
  emulators: Emulator[];
  /** Open the detailed per-file BIOS modal for an emulator. */
  onCheck: (emulator: Emulator) => void;
  /** Guided fix: open the emulator editor (BIOS folder lives there). */
  onFix: (emulator: Emulator) => void;
}

export default function EmulatorBiosBoard({ emulators, onCheck, onFix }: EmulatorBiosBoardProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<BiosBoardEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (announce = false) => {
      setRefreshing(true);
      try {
        const rows = await invoke<BiosBoardEntry[]>("check_all_bios_status");
        setEntries(rows);
        if (announce) showToast(t("emulators.biosBoard.checked"), "success");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setRefreshing(false);
      }
    },
    [showToast, t]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const byId = new Map(emulators.map((e) => [e.id, e]));
  const totals = entries ? biosBoardTotals(entries) : null;

  return (
    <section className="emu-bios-board" aria-label={t("emulators.biosBoard.title")}>
      <header className="emu-bios-board__head">
        <div className="emu-bios-board__title-wrap">
          <h2 className="emu-bios-board__title">{t("emulators.biosBoard.title")}</h2>
          <p className="emu-bios-board__subtitle">{t("emulators.biosBoard.subtitle")}</p>
        </div>
        <div className="emu-bios-board__summary">
          {totals && (
            <>
              <span className="emu-bios-board__pill emu-bios-board__pill--ok">
                <CheckCircle2 size={13} /> {totals.ready}
              </span>
              <span className="emu-bios-board__pill emu-bios-board__pill--warn">
                <AlertTriangle size={13} /> {totals.missing}
              </span>
              <span className="emu-bios-board__pill emu-bios-board__pill--muted">
                <ShieldQuestionMark size={13} /> {totals.unconfigured}
              </span>
            </>
          )}
          <Button
            variant="ghost"
            iconOnly
            title={t("emulators.biosBoard.refresh")}
            aria-label={t("emulators.biosBoard.refresh")}
            leftIcon={<RefreshCw size={14} />}
            onClick={() => void load(true)}
            disabled={refreshing}
          />
        </div>
      </header>

      {entries === null ? (
        <p className="emu-bios-board__empty">{t("emulators.biosBoard.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="emu-bios-board__empty">{t("emulators.biosBoard.none")}</p>
      ) : (
        <ul className="emu-bios-board__rows">
          {entries.map((entry) => {
            const status = biosBoardStatus(entry);
            const emu = byId.get(entry.emulatorId) ?? null;
            const mandatoryMissing = entry.check.requirements.filter(
              (r) => r.mandatory && !r.found
            ).length;
            const badHashes = entry.check.requirements.filter((r) => r.hashOk === false).length;
            return (
              <li
                key={entry.emulatorId}
                className={`emu-bios-board__row emu-bios-board__row--${status}`}
              >
                <div className="emu-bios-board__info">
                  <span className="emu-bios-board__name">{entry.emulatorName}</span>
                  <span className="emu-bios-board__platform">{entry.platform}</span>
                </div>
                <span className={`emu-bios-board__status emu-bios-board__status--${status}`}>
                  {status === "ready"
                    ? t("emulators.biosBoard.status.ready")
                    : status === "unconfigured"
                      ? t("emulators.biosBoard.status.unconfigured")
                      : t("emulators.biosBoard.status.missing", { count: mandatoryMissing })}
                </span>
                {badHashes > 0 && (
                  <span className="emu-bios-board__hash-warn">
                    {t("emulators.biosBoard.hashMismatch", { count: badHashes })}
                  </span>
                )}
                <div className="emu-bios-board__actions">
                  {emu && (
                    <Button variant="ghost" size="sm" onClick={() => onCheck(emu)}>
                      {t("emulators.biosBoard.details")}
                    </Button>
                  )}
                  {status !== "ready" && emu && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Settings2 size={13} />}
                      onClick={() => onFix(emu)}
                    >
                      {t("emulators.biosBoard.fix")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
