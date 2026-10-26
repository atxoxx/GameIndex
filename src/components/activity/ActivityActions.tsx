import {
  Camera,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  Image,
  MoreHorizontal,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui";
import { Popover } from "../ui/Popover";
import { useLanguage } from "../../context/LanguageContext";

export interface ActivityActionsProps {
  onLogSession: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onShareRecap: () => void;
  onCapturePage: () => void;
  onCopySummary: () => void;
  onOpenWrapped?: () => void;
  /** Hides labels on narrow surfaces (game tab header). */
  compact?: boolean;
}

/**
 * The one action cluster for both activity surfaces: the primary create
 * action stays a labelled button, exports live behind one menu, and the
 * rarely-used utilities sit in an overflow.
 */
export function ActivityActions({
  onLogSession,
  onExportCsv,
  onExportJson,
  onShareRecap,
  onCapturePage,
  onCopySummary,
  onOpenWrapped,
  compact = false,
}: ActivityActionsProps) {
  const { t } = useLanguage();

  return (
    <div className="activity-actions">
      <Button
        variant="primary"
        size="sm"
        leftIcon={<Plus size={14} />}
        onClick={onLogSession}
      >
        {compact ? t("activityManual.logSessionBtn") : t("activityWs.actions.logSession")}
      </Button>

      <Popover
        label={t("activityWs.export.menu")}
        align="end"
        width={232}
        trigger={(props) => (
          <Button
            {...props}
            variant="secondary"
            size="sm"
            leftIcon={<Download size={14} />}
          >
            {t("activityWs.export.menu")}
          </Button>
        )}
      >
        {(close) => (
          <>
            <span className="ui-popover__label">{t("activityWs.export.menu")}</span>
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item"
              onClick={() => {
                close();
                onExportCsv();
              }}
            >
              <span className="ui-popover__item-icon">
                <FileSpreadsheet size={15} />
              </span>
              <span className="ui-popover__item-label">{t("activityWs.export.csv")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item"
              onClick={() => {
                close();
                onExportJson();
              }}
            >
              <span className="ui-popover__item-icon">
                <FileJson size={15} />
              </span>
              <span className="ui-popover__item-label">{t("activityWs.export.json")}</span>
            </button>
            <div className="ui-popover__separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item"
              onClick={() => {
                close();
                onShareRecap();
              }}
            >
              <span className="ui-popover__item-icon">
                <Image size={15} />
              </span>
              <span className="ui-popover__item-label">{t("activityWs.export.recap")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item"
              onClick={() => {
                close();
                onCapturePage();
              }}
            >
              <span className="ui-popover__item-icon">
                <Camera size={15} />
              </span>
              <span className="ui-popover__item-label">{t("activityWs.export.page")}</span>
            </button>
          </>
        )}
      </Popover>

      <Popover
        label={t("activityWs.more.menu")}
        align="end"
        width={230}
        trigger={(props) => (
          <Button
            {...props}
            variant="secondary"
            size="sm"
            iconOnly
            aria-label={t("activityWs.more.menu")}
            leftIcon={<MoreHorizontal size={16} />}
          />
        )}
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item"
              onClick={() => {
                close();
                onCopySummary();
              }}
            >
              <span className="ui-popover__item-icon">
                <Copy size={15} />
              </span>
              <span className="ui-popover__item-label">{t("activityWs.more.copySummary")}</span>
            </button>
            {onOpenWrapped && (
              <button
                type="button"
                role="menuitem"
                className="ui-popover__item"
                onClick={() => {
                  close();
                  onOpenWrapped();
                }}
              >
                <span className="ui-popover__item-icon">
                  <Sparkles size={15} />
                </span>
                <span className="ui-popover__item-label">{t("activityWs.more.wrapped")}</span>
              </button>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}

export default ActivityActions;
