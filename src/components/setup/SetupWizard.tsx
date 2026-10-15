import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSetupWizard } from "../../context/SetupWizardContext";
import { Button } from "../ui";
import { SETUP_STEPS } from "./setupSteps";

/**
 * SetupWizard — the first-run walkthrough, rendered as a full-screen
 * portal above the app shell. Every control writes through the real
 * settings setters (live-apply), so Skip and Finish only record that the
 * wizard was seen; they never need to commit a draft.
 */
export default function SetupWizard() {
  const { t } = useLanguage();
  const { isOpen, closeWizard, finishWizard } = useSetupWizard();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeWizard();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeWizard]);

  const goBack = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
  const goNext = useCallback(
    () => setIndex((i) => Math.min(i + 1, SETUP_STEPS.length - 1)),
    [],
  );

  if (!isOpen) return null;

  const step = SETUP_STEPS[index];
  const isFirst = index === 0;
  const isLast = index === SETUP_STEPS.length - 1;
  const StepBody = step.Component;

  return createPortal(
    <div
      className="setup-wizard"
      role="dialog"
      aria-modal="true"
      aria-label={t("setup.wizard.title")}
    >
      <div className="setup-wizard__panel">
        <aside className="setup-wizard__rail">
          <div className="setup-wizard__brand">
            <span className="setup-wizard__brand-mark" aria-hidden="true">
              GI
            </span>
            <span className="setup-wizard__brand-name">{t("setup.wizard.title")}</span>
          </div>
          <nav className="setup-wizard__steps">
            {SETUP_STEPS.map((s, i) => {
              const Icon = s.icon;
              const state = i === index ? "is-current" : i < index ? "is-done" : "";
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`setup-rail-item ${state}`.trim()}
                  aria-current={i === index ? "step" : undefined}
                  onClick={() => setIndex(i)}
                >
                  <span className="setup-rail-item__icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className="setup-rail-item__label">{t(s.titleKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="setup-wizard__main">
          <header className="setup-wizard__header">
            <div className="setup-wizard__heading">
              <h2 className="setup-wizard__title">{t(step.titleKey)}</h2>
              <p className="setup-wizard__desc">{t(step.descKey)}</p>
            </div>
            <button
              type="button"
              className="setup-wizard__close"
              aria-label={t("setup.wizard.close")}
              onClick={closeWizard}
            >
              <X size={18} />
            </button>
          </header>

          <div className="setup-wizard__body">
            <StepBody />
          </div>

          <footer className="setup-wizard__footer">
            <span className="setup-wizard__progress">
              {t("setup.wizard.step", {
                current: index + 1,
                total: SETUP_STEPS.length,
              })}
            </span>
            <div className="setup-wizard__actions">
              <Button variant="ghost" onClick={closeWizard}>
                {t("setup.wizard.skip")}
              </Button>
              <Button
                variant="secondary"
                onClick={goBack}
                disabled={isFirst}
                leftIcon={<ChevronLeft size={16} />}
              >
                {t("setup.wizard.back")}
              </Button>
              {isLast ? (
                <Button variant="primary" onClick={finishWizard}>
                  {t("setup.wizard.finish")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={goNext}
                  rightIcon={<ChevronRight size={16} />}
                >
                  {t("setup.wizard.next")}
                </Button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
