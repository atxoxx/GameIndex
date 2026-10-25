import { Cpu } from "lucide-react";
import { ToggleCard } from "../EditFields";
import type { EditSectionKey } from "../draftKeys";
import { useEditGame } from "../EditGameContext";
import { RunnerSection } from "./RunnerSection";
import { GraphicsSection } from "./GraphicsSection";
import { ToolsSection } from "./ToolsSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { MaintenanceSection } from "./MaintenanceSection";

export function CompatibilityArea({ section }: { section: EditSectionKey }) {
  const { t, compatEnabled, setCompatEnabled } = useEditGame();

  return (
    <div className="edit-area">
      <ToggleCard
        id="compat-enabled"
        icon={<Cpu size={17} aria-hidden="true" />}
        title={t("gameEdit.compatibility.bannerTitle")}
        description={t("gameEdit.compatibility.bannerDesc")}
        checked={compatEnabled}
        onChange={setCompatEnabled}
        badge={
          <span className={`edit-badge${compatEnabled ? " is-on" : ""}`}>
            {compatEnabled
              ? t("edit.badge.enabled")
              : t("edit.badge.disabled")}
          </span>
        }
      />

      {section === "runner" && <RunnerSection />}
      {section === "graphics" && <GraphicsSection />}
      {section === "tools" && <ToolsSection />}
      {section === "environment" && <EnvironmentSection />}
      {section === "maintenance" && <MaintenanceSection />}
    </div>
  );
}
