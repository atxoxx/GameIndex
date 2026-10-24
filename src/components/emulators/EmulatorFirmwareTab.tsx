// Firmware tab: the selected system's BIOS requirements plus the library-wide
// readiness board. Firmware is the number one reason an emulator "is set up"
// but still refuses to boot, so it gets a first-class tab instead of a banner.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  RefreshCw,
  Settings2,
  ShieldQuestionMark,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, Panel } from "../ui";
import type { BiosCheckResult, Emulator } from "../../types/emulator";
import EmulatorBiosBoard from "./EmulatorBiosBoard";

interface FirmwareTabProps {
  emulator: Emulator;
  emulators: Emulator[];
  onEdit: () => void;
  onEditEmulator: (emulator: Emulator) => void;
  onOpenFolder: (folder: string) => void;
  onCheckBios: (emulator: Emulator) => void;
}

export default function EmulatorFirmwareTab({
  emulator,
  emulators,
  onEdit,
  onEditEmulator,
  onOpenFolder,
  onCheckBios,
}: FirmwareTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [result, setResult] = useState<BiosCheckResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const check = await invoke<BiosCheckResult>("check_bios_status", {
        emulatorId: emulator.id,
      });
      setResult(check);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [emulator.id, showToast]);

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);

  const mandatory = result?.requirements.filter((r) => r.mandatory) ?? [];
  const mandatoryMissing = mandatory.filter((r) => !r.found);
  const badHashes = result?.requirements.filter((r) => r.hashOk === false) ?? [];
  const allGood = result?.configured && result.requirements.length > 0 && mandatoryMissing.length === 0 && badHashes.length === 0;

  return (
    <div className="emu-wb-tab-body emu-wb-firmware">
      <Panel
        tone="raised"
        heading={t("emulators.bios.title")}
        eyebrow={emulator.platform}
        icon={<ShieldQuestionMark size={16} />}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Settings2 size={14} />}
              onClick={onEdit}
            >
              {t("emulators.edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              leftIcon={<RefreshCw size={15} />}
              aria-label={t("emulators.biosBoard.refresh")}
              title={t("emulators.biosBoard.refresh")}
              isLoading={loading}
              onClick={() => void load()}
            />
          </>
        }
      >
        <div className="emu-wb-firmware-head">
          <div className={`emu-wb-firmware-verdict${allGood ? " is-ok" : ""}`}>
            {result === null ? (
              <span>{t("emulators.bios.loading")}</span>
            ) : !result.configured ? (
              <>
                <ShieldQuestionMark size={18} />
                <span>{t("emulators.bios.notConfigured")}</span>
              </>
            ) : allGood ? (
              <>
                <CheckCircle2 size={18} />
                <span>{t("emulators.bios.ok")}</span>
              </>
            ) : (
              <>
                <AlertTriangle size={18} />
                <span>
                  {t("emulators.bios.missingCount", { count: mandatoryMissing.length })}
                </span>
              </>
            )}
          </div>

          {result?.biosFolder ? (
            <button
              type="button"
              className="emu-wb-firmware-path"
              onClick={() => onOpenFolder(result.biosFolder!)}
              title={result.biosFolder}
            >
              <FolderOpen size={13} />
              <span>{result.biosFolder}</span>
            </button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              {t("emulators.bios.setFolder")}
            </Button>
          )}
        </div>

        {result && result.requirements.length === 0 ? (
          <p className="emu-wb-hint">{t("emulators.bios.noRequirements")}</p>
        ) : result ? (
          <ul className="emu-wb-firmware-list">
            {result.requirements.map((req) => (
              <li
                key={req.name}
                className={`emu-wb-firmware-row${req.found ? " is-found" : " is-missing"}`}
              >
                <span className="emu-wb-firmware-state" aria-hidden>
                  {req.found ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                </span>
                <span className="emu-wb-firmware-info">
                  <span className="emu-wb-firmware-name">{req.name}</span>
                  {req.description && (
                    <span className="emu-wb-firmware-desc">{req.description}</span>
                  )}
                </span>
                {req.hashOk === false && (
                  <span className="emu-wb-firmware-warn">{t("emulators.bios.invalid")}</span>
                )}
                {req.mandatory ? (
                  <span className="emu-wb-firmware-tag">{t("emulators.bios.required")}</span>
                ) : (
                  <span className="emu-wb-firmware-tag emu-wb-firmware-tag--muted">
                    {t("emulators.bios.optional")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {result && result.requirements.length > 0 && (
          <div className="emu-wb-firmware-foot">
            <Button variant="ghost" size="sm" onClick={() => onCheckBios(emulator)}>
              {t("emulators.bios.openDetails")}
            </Button>
          </div>
        )}
      </Panel>

      <Panel tone="plain">
        <EmulatorBiosBoard
          emulators={emulators}
          onCheck={(emu) => onCheckBios(emu)}
          onFix={(emu) => onEditEmulator(emu)}
        />
      </Panel>
    </div>
  );
}
