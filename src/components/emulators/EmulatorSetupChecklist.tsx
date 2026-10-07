import { Check, Circle } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import type { SetupStep, SetupStepKey } from "./emulatorUi";

interface ChecklistProps {
  steps: SetupStep[];
  progress: { done: number; total: number };
  onFix: (key: SetupStepKey) => void;
}

const STEP_LABEL_KEYS: Record<SetupStepKey, string> = {
  executable: "emulators.setup.executable",
  romFolder: "emulators.setup.romFolder",
  scan: "emulators.setup.scan",
};

export default function EmulatorSetupChecklist({
  steps,
  progress,
  onFix,
}: ChecklistProps) {
  const { t } = useLanguage();

  if (steps.every((step) => step.done)) return null;

  return (
    <section className="emu-setup" aria-label={t("emulators.setup.title")}>
      <div className="emu-setup-head">
        <h3>{t("emulators.setup.title")}</h3>
        <span className="emu-setup-progress">
          {t("emulators.setup.progress", {
            done: progress.done,
            total: progress.total,
          })}
        </span>
      </div>
      <ul className="emu-setup-list">
        {steps.map((step) => (
          <li
            key={step.key}
            className={`emu-setup-step${step.done ? " is-done" : ""}`}
          >
            <span className="emu-setup-icon" aria-hidden="true">
              {step.done ? <Check size={15} /> : <Circle size={15} />}
            </span>
            <span className="emu-setup-label">{t(STEP_LABEL_KEYS[step.key])}</span>
            {!step.done && (
              <Button
                className="emu-setup-action"
                variant="secondary"
                size="sm"
                onClick={() => onFix(step.key)}
              >
                {t("emulators.add.setup")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
