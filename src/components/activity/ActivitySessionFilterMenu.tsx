import { Check, ListFilter } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { Popover } from "../ui/Popover";
import {
  countActiveSessionFilters,
  type ActivitySessionFilters,
  type DurationFilter,
  type TelemetryFilter,
} from "../../utils/activity/sessionQuery";

export interface ActivitySessionFilterMenuProps {
  filters: ActivitySessionFilters;
  onChange: (patch: Partial<ActivitySessionFilters>) => void;
}

const TELEMETRY: TelemetryFilter[] = ["all", "telemetry", "notes"];
const DURATIONS: DurationFilter[] = ["all", "quick", "medium", "long"];

function telemetryKey(value: TelemetryFilter): string {
  if (value === "telemetry") return "activitySessions.filterWithTelemetry";
  if (value === "notes") return "activitySessions.filterWithNotes";
  return "activitySessions.filterAll";
}

function durationKey(value: DurationFilter): string {
  if (value === "quick") return "activityInsights.sessionBucket.quick";
  if (value === "medium") return "activityInsights.sessionBucket.short";
  if (value === "long") return "activityInsights.sessionBucket.long";
  return "activitySessions.allDurations";
}

/**
 * Advanced session filters live behind one labelled button. The active
 * choices are repeated as removable chips beside the list, so a filtered view
 * never looks like a complete one.
 */
export function ActivitySessionFilterMenu({
  filters,
  onChange,
}: ActivitySessionFilterMenuProps) {
  const { t } = useLanguage();
  const activeCount = countActiveSessionFilters(filters);

  return (
    <div className="activity-session-filters">
      <Popover
        label={t("activitySessions.filterType")}
        align="end"
        width={262}
        trigger={(props) => (
          <Button
            {...props}
            variant="secondary"
            size="sm"
            active={activeCount > 0}
            leftIcon={<ListFilter size={14} />}
          >
            {t("activityWs.sessions.filters")}
            {activeCount > 0 && <span className="activity-scope__count">{activeCount}</span>}
          </Button>
        )}
      >
        {(close) => (
          <>
            <span className="ui-popover__label">{t("activityWs.sessions.data")}</span>
            {TELEMETRY.map((value) => (
              <button
                key={value}
                type="button"
                className={`ui-popover__item${filters.telemetry === value ? " is-active" : ""}`}
                onClick={() => onChange({ telemetry: value })}
              >
                <span className="ui-popover__item-label">{t(telemetryKey(value))}</span>
                {filters.telemetry === value && <Check size={14} />}
              </button>
            ))}
            <div className="ui-popover__separator" role="separator" />
            <span className="ui-popover__label">{t("activityWs.sessions.duration")}</span>
            {DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`ui-popover__item${filters.duration === value ? " is-active" : ""}`}
                onClick={() => onChange({ duration: value })}
              >
                <span className="ui-popover__item-label">{t(durationKey(value))}</span>
                {filters.duration === value && <Check size={14} />}
              </button>
            ))}
            {(activeCount > 0 || filters.sort !== "date" || filters.dir !== "desc") && (
              <>
                <div className="ui-popover__separator" role="separator" />
                <div className="ui-popover__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onChange({
                        telemetry: "all",
                        duration: "all",
                        sort: "date",
                        dir: "desc",
                      });
                      close();
                    }}
                  >
                    {t("activityWs.sessions.clearFilters")}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}

export default ActivitySessionFilterMenu;
