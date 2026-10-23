import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSetupWizard } from "../../context/SetupWizardContext";
import { GamepadProvider } from "../../hooks/GamepadProvider";
import { Button } from "../ui";
import { SETUP_STEPS } from "./setupSteps";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * SetupWizard — the first-run walkthrough, rendered as a full-screen
 * portal above the app shell. Every control writes through the real
 * settings setters (live-apply), so Skip and Finish only record that the
 * wizard was seen; they never need to commit a draft.
 *
 * The shell is deliberately tonal rather than framed: a sunken step rail
 * carries progress, the content column floats on the page tint, and the
 * only accent marks are the current step, the check on completed steps,
 * and the primary action.
 */
export default function SetupWizard() {
  const { t } = useLanguage();
  const { isOpen, closeWizard, finishWizard } = useSetupWizard();
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  // Move focus into the panel on open, trap Tab inside it, and hand focus
  // back to whatever was focused before the wizard appeared.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeWizard();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
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
  const StepIcon = step.icon;
  const progressLabel = t("setup.wizard.step", {
    current: index + 1,
    total: SETUP_STEPS.length,
  });

  // The wizard renders beside <AppShell>, outside the shell's
  // GamepadProvider — embedded settings views (the integrations panel)
  // rely on gamepad hooks, so mount the inert desktop provider here.
  return createPortal(
    <GamepadProvider enabled={false}>
      <div
        className="setup-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-wizard-title"
        aria-describedby="setup-wizard-desc"
      >
        <div className="setup-wizard__panel" ref={panelRef} tabIndex={-1}>
          <aside className="setup-wizard__rail">
            <div className="setup-wizard__brand">
              <span className="setup-wizard__brand-mark" aria-hidden="true">
                GI
              </span>
              <span className="setup-wizard__brand-text">
                <span className="setup-wizard__brand-name">GameIndex</span>
                <span className="setup-wizard__brand-sub">
                  {t("setup.wizard.title")}
                </span>
              </span>
            </div>

            <nav className="setup-wizard__steps" aria-label={t("setup.wizard.title")}>
              {SETUP_STEPS.map((s, i) => {
                const Icon = s.icon;
                const isDone = i < index;
                const isCurrent = i === index;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={[
                      "setup-rail-item",
                      isCurrent ? "is-current" : "",
                      isDone ? "is-done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={t(s.titleKey)}
                    title={t(s.titleKey)}
                    onClick={() => setIndex(i)}
                  >
                    <span className="setup-rail-item__icon" aria-hidden="true">
                      {isDone ? <Check size={15} /> : <Icon size={15} />}
                    </span>
                    <span className="setup-rail-item__label">{t(s.titleKey)}</span>
                    <span className="setup-rail-item__index" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="setup-wizard__rail-foot">
              <div className="setup-wizard__meter" aria-hidden="true">
                {SETUP_STEPS.map((s, i) => (
                  <span
                    key={s.id}
                    className={
                      i < index ? "is-done" : i === index ? "is-current" : ""
                    }
                  />
                ))}
              </div>
              <span className="setup-wizard__rail-count">{progressLabel}</span>
            </div>
          </aside>

          <div className="setup-wizard__main">
            <header className="setup-wizard__header">
              <span className="setup-wizard__header-icon" aria-hidden="true">
                <StepIcon size={22} />
              </span>
              <div className="setup-wizard__heading">
                <span className="setup-wizard__eyebrow">{progressLabel}</span>
                <h2 className="setup-wizard__title" id="setup-wizard-title">
                  {t(step.titleKey)}
                </h2>
                <p className="setup-wizard__desc" id="setup-wizard-desc">
                  {t(step.descKey)}
                </p>
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

            <div className="setup-wizard__body" key={step.id}>
              <StepBody />
            </div>

            <footer className="setup-wizard__footer">
              {isLast ? (
                <span aria-hidden="true" />
              ) : (
                <Button variant="ghost" size="sm" onClick={closeWizard}>
                  {t("setup.wizard.skip")}
                </Button>
              )}
              <div className="setup-wizard__actions">
                <Button
                  variant="secondary"
                  onClick={goBack}
                  disabled={isFirst}
                  leftIcon={<ChevronLeft size={16} />}
                >
                  {t("setup.wizard.back")}
                </Button>
                {isLast ? (
                  <Button
                    variant="primary"
                    onClick={finishWizard}
                    rightIcon={<Check size={16} />}
                  >
                    {t("setup.wizard.open")}
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
      </div>
    </GamepadProvider>,
    document.body,
  );
}
