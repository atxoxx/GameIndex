// Bottom legend for the Big Screen shell.
//
// This bar is the single affordance telling a couch user what the
// buttons do, so its words follow the ACTIVE screen: B reads Back when
// a parent route exists and Exit on a top-level screen (mirroring
// `bigScreenParentOf`), and LB/RB reads Sections or Tabs from the
// mounted page's declaration (see bigscreenLegend.ts).

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { bigScreenParentOf } from "../../../bigscreen/registry";
import { useBumperScope } from "../bigscreenLegend";

function LegendKey({ children }: { children: string }) {
  return <b className="bs-key">{children}</b>;
}

export default function BigScreenFooter() {
  const { t, language } = useLanguage();
  const { pathname } = useLocation();
  const bumperScope = useBumperScope();
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () =>
      setTime(
        new Intl.DateTimeFormat(language, {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
      );
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [language]);

  const hasParent = bigScreenParentOf(pathname) !== null;

  return (
    <div className="bs-footer" aria-hidden="true">
      <span className="bs-footer-brand">GameIndex</span>
      <div className="bs-footer-legend">
        <span className="bs-hint">
          <LegendKey>A</LegendKey>
          {t("bigscreen.shell.selectHint")}
        </span>
        <span className="bs-hint">
          <LegendKey>B</LegendKey>
          {t(hasParent ? "bigscreen.shell.backHint" : "bigscreen.shell.exitHint")}
        </span>
        <span className="bs-hint">
          <LegendKey>LB</LegendKey>
          <LegendKey>RB</LegendKey>
          {t(
            bumperScope === "tabs"
              ? "bigscreen.shell.tabsHint"
              : "bigscreen.shell.sectionsHint",
          )}
        </span>
        <span className="bs-hint bs-hint--optional">
          <LegendKey>Y</LegendKey>
          {t("bigscreen.shell.pointerHint")}
        </span>
        <span className="bs-hint bs-hint--optional">
          <LegendKey>Menu</LegendKey>
          {t("bigscreen.shell.guideHint")}
        </span>
      </div>
      <span className="bs-footer-clock">{time}</span>
    </div>
  );
}
