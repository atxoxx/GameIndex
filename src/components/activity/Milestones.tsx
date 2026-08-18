import { useState, type ReactNode } from "react";
import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import type { MilestoneKind, MilestoneLadder } from "./insights";
import * as Icons from "./Icons";

const KIND_LABEL_KEY: Record<MilestoneKind, string> = {
  hours: "activityInsights.milestone.kind.hours",
  sessions: "activityInsights.milestone.kind.sessions",
  games: "activityInsights.milestone.kind.games",
  streak: "activityInsights.milestone.kind.streak",
  longSession: "activityInsights.milestone.kind.longSession",
  days: "activityInsights.milestone.kind.days",
};

const STEP_LABEL_KEY: Record<MilestoneKind, string> = {
  hours: "activityInsights.milestone.hours",
  sessions: "activityInsights.milestone.sessions",
  games: "activityInsights.milestone.games",
  streak: "activityInsights.milestone.streak",
  longSession: "activityInsights.milestone.longSession",
  days: "activityInsights.milestone.days",
};

function milestoneCount(kind: MilestoneKind, target: number): number {
  return kind === "longSession" ? Math.round(target / 60) : target;
}

function kindIcon(kind: MilestoneKind, size = 14): ReactNode {
  switch (kind) {
    case "hours":
      return <Icons.Clock size={size} />;
    case "sessions":
      return <Icons.Flame size={size} />;
    case "games":
      return <Icons.Trophy size={size} />;
    case "streak":
      return <Icons.Zap size={size} />;
    case "longSession":
      return <Icons.Target size={size} />;
    case "days":
      return <Icons.Calendar size={size} />;
  }
}

/** Compact node label: "10h", "5d", "42", … */
function stepLabel(kind: MilestoneKind, target: number): string {
  const n = milestoneCount(kind, target);
  switch (kind) {
    case "hours":
    case "longSession":
      return `${n}h`;
    case "streak":
    case "days":
      return `${n}d`;
    default:
      return `${n}`;
  }
}

/** Human-readable current value shown in the ladder header. */
function currentValue(kind: MilestoneKind, value: number): string {
  switch (kind) {
    case "hours": {
      const h = Math.floor(value);
      const m = Math.round((value - h) * 60);
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    case "longSession":
      return formatPlayTime(value);
    case "streak":
    case "days":
      return `${Math.round(value)}d`;
    default:
      return `${Math.round(value)}`;
  }
}

function Ladder({ ladder }: { ladder: MilestoneLadder }) {
  const { t } = useLanguage();
  const { steps, kind, value } = ladder;
  const firstUnearned = steps.findIndex((s) => !s.earned);
  const allEarned = firstUnearned === -1;
  const span = Math.max(1, steps.length - 1);

  return (
    <div className="act-ladder">
      <div className="act-ladder__head">
        <span className="act-ladder__icon" aria-hidden="true">
          {kindIcon(kind, 14)}
        </span>
        <span className="act-ladder__name">{t(KIND_LABEL_KEY[kind])}</span>
        <span className="act-ladder__value">{currentValue(kind, value)}</span>
        {allEarned ? (
          <span className="act-ladder__next act-ladder__next--done">
            <Icons.Check size={11} />
            {t("activityInsights.milestone.maxed")}
          </span>
        ) : (
          <span className="act-ladder__next">
            {t("activityInsights.milestone.next", {
              value: stepLabel(kind, steps[firstUnearned].target),
            })}
          </span>
        )}
      </div>

      <div className="act-ladder__track">
        {steps.slice(0, -1).map((step, i) => {
          const next = steps[i + 1];
          const baseline = i === 0 ? 0 : step.target;
          let fill = 0;
          if (value >= next.target) {
            fill = 1;
          } else if (value > baseline && baseline < next.target) {
            fill = Math.max(0, Math.min(1, (value - baseline) / (next.target - baseline)));
          }
          return (
            <span
              key={`seg-${i}`}
              className="act-ladder__seg"
              style={{ left: `${(i / span) * 100}%`, width: `${(1 / span) * 100}%` }}
            >
              {fill > 0 && (
                <span className="act-ladder__seg-fill" style={{ width: `${fill * 100}%` }} />
              )}
            </span>
          );
        })}

        {steps.map((step, i) => {
          const isNext = i === firstUnearned;
          const cls = [
            "act-ladder__node",
            step.earned ? "act-ladder__node--earned" : "",
            isNext ? "act-ladder__node--next" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={step.id}
              className="act-ladder__step"
              style={{ left: `${(i / span) * 100}%` }}
            >
              <span
                className={cls}
                title={t(STEP_LABEL_KEY[step.kind], { count: milestoneCount(step.kind, step.target) })}
              >
                {step.earned ? <Icons.Check size={11} /> : <span className="act-ladder__dot" />}
              </span>
              <span className="act-ladder__label">{stepLabel(step.kind, step.target)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NextChip({ ladder }: { ladder: MilestoneLadder }) {
  const { t } = useLanguage();
  const next = ladder.steps.find((s) => !s.earned);
  const done = !next;
  const count = next ? milestoneCount(ladder.kind, next.target) : 0;
  const title = done
    ? `${t(KIND_LABEL_KEY[ladder.kind])} · ${t("activityInsights.milestone.maxed")}`
    : `${t(KIND_LABEL_KEY[ladder.kind])} · ${t(STEP_LABEL_KEY[ladder.kind], { count })}`;

  return (
    <span
      className={`act-milestone-chip${done ? " act-milestone-chip--done" : ""}`}
      title={title}
    >
      <span className="act-milestone-chip__icon">{kindIcon(ladder.kind, 11)}</span>
      <span className="act-milestone-chip__value">{done ? "✓" : stepLabel(ladder.kind, next!.target)}</span>
    </span>
  );
}

export function Milestones({ ladders }: { ladders: MilestoneLadder[] }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  if (ladders.length === 0) return null;
  const totalSteps = ladders.reduce((sum, l) => sum + l.steps.length, 0);
  const earnedSteps = ladders.reduce((sum, l) => sum + l.steps.filter((s) => s.earned).length, 0);
  const pct = totalSteps > 0 ? Math.round((earnedSteps / totalSteps) * 100) : 0;

  return (
    <section className="act-panel act-milestones">
      <button
        type="button"
        className="act-milestones__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="act-panel__icon" aria-hidden="true">
          <Icons.Award size={14} />
        </span>
        <span className="act-panel__title" role="heading" aria-level={3}>
          {t("activityInsights.milestones")}
        </span>
        <span className="act-milestones__count">
          {t("activityInsights.milestones.count", { earned: earnedSteps, total: totalSteps })}
        </span>
        <span
          className={`act-milestones__chevron${expanded ? " act-milestones__chevron--open" : ""}`}
          aria-hidden="true"
        >
          <Icons.ChevronDown size={14} />
        </span>
      </button>

      {expanded ? (
        <div className="act-milestones__ladders">
          {ladders.map((ladder) => (
            <Ladder key={ladder.kind} ladder={ladder} />
          ))}
        </div>
      ) : (
        <div className="act-milestones__overview">
          <div
            className="act-milestones__bar"
            role="progressbar"
            aria-valuenow={earnedSteps}
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-label={t("activityInsights.milestones")}
          >
            <span className="act-milestones__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="act-milestones__next">
            {ladders.map((ladder) => (
              <NextChip key={ladder.kind} ladder={ladder} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
