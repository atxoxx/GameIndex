import { useMemo, useState } from "react";
import {
  BookmarkPlus,
  CalendarDays,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "../ui";
import { Popover } from "../ui/Popover";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import type { ActivityRangeKey } from "../../utils/activity/range";
import type { SavedActivityView } from "../../utils/activity/savedViews";

export interface ActivityGameOption {
  id: string;
  name: string;
  minutes: number;
}

export interface ActivityScopeBarProps {
  rangeKey: ActivityRangeKey;
  rangeLabel: string;
  defaultFrom: string;
  defaultTo: string;
  /** Latest selectable day; custom ranges can still extend to today. */
  maxDate?: string;
  from: string;
  to: string;
  source: string;
  sourceOptions: string[];
  gameId: string | null;
  gameOptions: ActivityGameOption[];
  selectedGameLabel?: string;
  isDefaultScope: boolean;
  savedViews: SavedActivityView[];
  onRangeChange: (key: ActivityRangeKey) => void;
  onCustomRange: (from: string, to: string) => void;
  onSourceChange: (source: string) => void;
  onGameChange: (gameId: string | null) => void;
  onReset: () => void;
  onApplyView: (view: SavedActivityView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  showSource?: boolean;
  showGame?: boolean;
  showViews?: boolean;
}

const PRESETS: Array<{ key: Exclude<ActivityRangeKey, "custom">; labelKey: string }> = [
  { key: "7d", labelKey: "activity.7d" },
  { key: "30d", labelKey: "activity.30d" },
  { key: "90d", labelKey: "activity.90d" },
  { key: "all", labelKey: "activity.allTime" },
];

/**
 * The scope strip every Activity tab inherits. One range, one source and one
 * game selection feed the overview, the session list and the performance
 * board, so switching tabs never silently changes what is being measured.
 */
export function ActivityScopeBar({
  rangeKey,
  rangeLabel,
  defaultFrom,
  defaultTo,
  maxDate = defaultTo,
  from,
  to,
  source,
  sourceOptions,
  gameId,
  gameOptions,
  selectedGameLabel,
  isDefaultScope,
  savedViews,
  onRangeChange,
  onCustomRange,
  onSourceChange,
  onGameChange,
  onReset,
  onApplyView,
  onSaveView,
  onDeleteView,
  showSource = true,
  showGame = true,
  showViews = true,
}: ActivityScopeBarProps) {
  const { t } = useLanguage();
  const [draftFrom, setDraftFrom] = useState(from || defaultFrom);
  const [draftTo, setDraftTo] = useState(to || defaultTo);
  const [viewName, setViewName] = useState("");

  const gameOptionsWithSelection = useMemo(() => {
    if (!gameId || gameOptions.some((option) => option.id === gameId)) return gameOptions;
    return [{ id: gameId, name: selectedGameLabel ?? gameId, minutes: 0 }, ...gameOptions];
  }, [gameId, gameOptions, selectedGameLabel]);

  const sourceOptionsWithSelection = useMemo(() => {
    if (!source || source === "all" || sourceOptions.includes(source)) return sourceOptions;
    return [source, ...sourceOptions];
  }, [source, sourceOptions]);

  return (
    <div className="activity-scope" role="group" aria-label={t("activityWs.scope.label")}>
      <div className="activity-scope__range-group">
        <div className="activity-scope__ranges" role="group" aria-label={t("activity.range")}>
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`activity-scope__pill${rangeKey === preset.key ? " is-active" : ""}`}
              aria-pressed={rangeKey === preset.key}
              onClick={() => onRangeChange(preset.key)}
            >
              {t(preset.labelKey)}
            </button>
          ))}

          <Popover
            label={t("activityWs.scope.custom")}
            align="start"
            width={272}
            role="dialog"
            trigger={(props) => (
              <button
                {...props}
                type="button"
                className={`activity-scope__pill activity-scope__pill--custom${
                  rangeKey === "custom" ? " is-active" : ""
                }`}
                onClick={() => {
                  if (!props["aria-expanded"]) {
                    setDraftFrom(from || defaultFrom);
                    setDraftTo(to || defaultTo);
                  }
                  props.onClick();
                }}
              >
                <CalendarDays size={13} />
                {t("activityWs.scope.custom")}
              </button>
            )}
          >
            {(close) => (
              <div className="activity-scope__custom">
                <span className="ui-popover__label">{t("activityWs.scope.custom")}</span>
                <label className="ui-popover__field">
                  {t("activityWs.scope.from")}
                  <input
                    type="date"
                    value={draftFrom}
                    max={draftTo || maxDate}
                    aria-label={t("activityWs.scope.from")}
                    onChange={(event) => setDraftFrom(event.target.value)}
                  />
                </label>
                <label className="ui-popover__field">
                  {t("activityWs.scope.to")}
                  <input
                    type="date"
                    value={draftTo}
                    min={draftFrom}
                    max={maxDate}
                    aria-label={t("activityWs.scope.to")}
                    onChange={(event) => setDraftTo(event.target.value)}
                  />
                </label>
                <p className="ui-popover__hint">{t("activityWs.scope.customHint")}</p>
                <div className="ui-popover__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      close();
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!draftFrom || !draftTo}
                    onClick={() => {
                      onCustomRange(draftFrom, draftTo);
                      close();
                    }}
                  >
                    {t("activityWs.scope.apply")}
                  </Button>
                </div>
              </div>
            )}
          </Popover>
        </div>

        <span className="activity-scope__range-label">{rangeLabel}</span>
      </div>

      <div className="activity-scope__selects">
        {showSource && (
          <label className="activity-scope__select">
            <span className="activity-scope__select-label">{t("activityPage.source")}</span>
            <select
              value={source}
              onChange={(event) => onSourceChange(event.target.value)}
              aria-label={t("activityPage.source")}
            >
              <option value="all">{t("activityWs.scope.allSources")}</option>
              {sourceOptionsWithSelection.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>
        )}

        {showGame && (
          <label className="activity-scope__select">
            <span className="activity-scope__select-label">{t("activityWs.scope.game")}</span>
            <select
              value={gameId ?? "all"}
              onChange={(event) =>
                onGameChange(event.target.value === "all" ? null : event.target.value)
              }
              aria-label={t("activityWs.scope.game")}
            >
              <option value="all">{t("activityWs.scope.allGames")}</option>
              {gameOptionsWithSelection.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.minutes > 0 ? `${game.name} · ${formatPlayTime(game.minutes)}` : game.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {showViews && (
          <Popover
            label={t("activityWs.scope.views")}
            align="end"
            width={286}
            trigger={(props) => (
              <Button
                {...props}
                variant="secondary"
                size="sm"
                leftIcon={<BookmarkPlus size={14} />}
              >
                {t("activityWs.scope.views")}
                {savedViews.length > 0 && (
                  <span className="activity-scope__count">{savedViews.length}</span>
                )}
              </Button>
            )}
          >
            {(close) => (
              <div className="activity-scope__views">
                <span className="ui-popover__label">{t("activityWs.scope.savedViews")}</span>
                {savedViews.length === 0 ? (
                  <p className="ui-popover__empty">{t("activityWs.scope.noViews")}</p>
                ) : (
                  <div className="ui-popover__views">
                    {savedViews.map((view) => (
                      <div key={view.id} className="ui-popover__view-row">
                        <button
                          type="button"
                          className="ui-popover__item"
                          onClick={() => {
                            onApplyView(view);
                            close();
                          }}
                        >
                          <span className="ui-popover__item-label">{view.name}</span>
                        </button>
                        <button
                          type="button"
                          className="ui-popover__delete"
                          aria-label={t("activityWs.scope.deleteView")}
                          title={t("activityWs.scope.deleteView")}
                          onClick={() => onDeleteView(view.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ui-popover__separator" role="separator" />
                <label className="ui-popover__field">
                  {t("activityWs.scope.viewName")}
                  <input
                    type="text"
                    value={viewName}
                    maxLength={60}
                    placeholder={t("activityWs.scope.viewNamePlaceholder")}
                    aria-label={t("activityWs.scope.viewName")}
                    onChange={(event) => setViewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || !viewName.trim()) return;
                      onSaveView(viewName.trim());
                      setViewName("");
                      close();
                    }}
                  />
                </label>
                <div className="ui-popover__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Save size={13} />}
                    disabled={!viewName.trim()}
                    onClick={() => {
                      onSaveView(viewName.trim());
                      setViewName("");
                      close();
                    }}
                  >
                    {t("activityWs.scope.saveView")}
                  </Button>
                </div>
              </div>
            )}
          </Popover>
        )}

        {!isDefaultScope && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            title={t("activityWs.scope.reset")}
            aria-label={t("activityWs.scope.reset")}
            leftIcon={<RotateCcw size={14} />}
            onClick={onReset}
          />
        )}
      </div>
    </div>
  );
}

export default ActivityScopeBar;
