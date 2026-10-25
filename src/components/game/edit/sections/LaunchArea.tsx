import type { EditSectionKey } from "../draftKeys";
import { ExecutableSection } from "./ExecutableSection";
import { OptionsSection } from "./OptionsSection";
import { AutomationSection } from "./AutomationSection";
import { IntegrationsSection } from "./IntegrationsSection";

export function LaunchArea({ section }: { section: EditSectionKey }) {
  return (
    <div className="edit-area">
      {section === "executable" && <ExecutableSection />}
      {section === "options" && <OptionsSection />}
      {section === "automation" && <AutomationSection />}
      {section === "integrations" && <IntegrationsSection />}
    </div>
  );
}
