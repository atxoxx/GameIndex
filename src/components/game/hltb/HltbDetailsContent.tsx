import { useId, useState, type RefObject } from "react";
import type { HltbStats } from "../../../types/game";
import { parsePlayTime } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { SubTabs } from "../../ui";
import type { SubTabItem } from "../../ui/SubTabs";
import { IconClock, IconInfo, IconPlatform, IconStar, IconUsers } from "../icons";
import HltbHero from "./HltbHero";
import HltbPlatformsSection from "./HltbPlatformsSection";
import HltbRelatedSection from "./HltbRelatedSection";
import HltbSpecialSection from "./HltbSpecialSection";
import HltbTimesSection from "./HltbTimesSection";
import {
  buildInvestedRows,
  buildSpeedRows,
  buildStyleRows,
  type StyleKey,
  type TabId,
} from "./hltbShared";
import "./HltbDetails.css";

export interface HltbDetailsContentProps {
  stats: HltbStats;
  playTime?: string;
  /** Desktop tabbed sheet, or a stacked document for Big Screen. */
  variant?: "tabbed" | "stacked";
  /** Heading id owned by the modal for `aria-labelledby`. */
  headingId?: string;
  onClose?: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Shared HLTB body. Desktop gets the tabbed sheet; Big Screen renders the
 * same sections stacked because a tab strip and a gamepad are a poor match.
 */
export function HltbDetailsContent({
  stats,
  playTime,
  variant = "stacked",
  headingId,
  onClose,
  closeButtonRef,
}: HltbDetailsContentProps) {
  const { t } = useLanguage();
  const fallbackId = useId();
  const titleId = headingId ?? fallbackId;

  const styles = buildStyleRows(stats, t);
  const speedRows = buildSpeedRows(stats, t);
  const investedRows = buildInvestedRows(stats, t);
  const platforms = stats.platformStats ?? [];
  const related = stats.related ?? [];

  const playSeconds = Math.max(0, parsePlayTime(playTime ?? "")) * 60;

  const [activeTab, setActiveTab] = useState<TabId>("times");
  const [selectedKey, setSelectedKey] = useState<StyleKey>("main");
  const [showTable, setShowTable] = useState(false);

  const activeStyle = styles.find((row) => row.key === selectedKey) ?? styles[0];

  const allTabs: SubTabItem<TabId>[] = [
    { id: "times", label: t("hltb.tabTimes"), icon: IconClock },
    { id: "platforms", label: t("hltb.tabPlatforms"), icon: IconPlatform },
    { id: "related", label: t("hltb.tabRelated"), icon: IconStar },
  ];
  const tabItems = allTabs.filter((item) => {
    if (item.id === "times") {
      return styles.length > 0 || speedRows.length > 0 || investedRows.length > 0;
    }
    if (item.id === "platforms") return platforms.length > 0;
    return related.length > 0;
  });

  const safeTab: TabId = tabItems.some((item) => item.id === activeTab)
    ? activeTab
    : tabItems[0]?.id ?? "times";

  const timesContent = (
    <>
      {styles.length > 0 && (
        <HltbTimesSection
          styles={styles}
          activeStyle={activeStyle}
          playSeconds={playSeconds}
          showTable={showTable}
          onToggleTable={() => setShowTable((value) => !value)}
          onSelect={setSelectedKey}
          t={t}
        />
      )}
      {speedRows.length > 0 && (
        <HltbSpecialSection
          title={t("hltb.speedruns")}
          icon={<IconClock size={14} />}
          rows={speedRows}
          metaLabel="range"
          t={t}
        />
      )}
      {investedRows.length > 0 && (
        <HltbSpecialSection
          title={t("hltb.coopMp")}
          icon={<IconUsers size={14} />}
          rows={investedRows}
          metaLabel="invested"
          t={t}
        />
      )}
    </>
  );

  const tabContent =
    safeTab === "times" ? (
      timesContent
    ) : safeTab === "platforms" ? (
      <HltbPlatformsSection stats={stats} t={t} />
    ) : (
      <HltbRelatedSection stats={stats} t={t} />
    );

  return (
    <div className={`hltb-details hltb-details--${variant}`}>
      <HltbHero
        stats={stats}
        playTime={playTime}
        activeStyle={activeStyle}
        styles={styles}
        headingId={titleId}
        onClose={onClose}
        closeButtonRef={closeButtonRef}
      />

      {tabItems.length === 0 ? (
        <div className="hltb-empty">
          <IconInfo size={22} />
          <p>{t("hltb.noData")}</p>
        </div>
      ) : variant === "tabbed" ? (
        <>
          {tabItems.length > 1 && (
            <div className="hltb-tabbar">
              <SubTabs
                items={tabItems}
                value={safeTab}
                onChange={setActiveTab}
                ariaLabel={t("hltb.tabsLabel")}
              />
            </div>
          )}
          <div
            className="hltb-panel"
            role="tabpanel"
            aria-label={
              tabItems.find((item) => item.id === safeTab)?.label ??
              t("hltb.tabsLabel")
            }
          >
            {tabContent}
          </div>
        </>
      ) : (
        <div className="hltb-sections hltb-sections--stacked">
          {timesContent}
          <HltbPlatformsSection stats={stats} t={t} />
          <HltbRelatedSection stats={stats} t={t} />
        </div>
      )}
    </div>
  );
}

export default HltbDetailsContent;
