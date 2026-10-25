import {
  Activity,
  CircleX,
  FolderOpen,
  LayoutGrid,
  Settings2,
  Terminal,
  Wrench,
} from "lucide-react";
import { Disclosure } from "../../../ui";
import { SectionHeader, SettingCard } from "../EditFields";
import { useEditGame } from "../EditGameContext";

export function MaintenanceSection() {
  const {
    t,
    runningTool,
    handleRunWineTool,
    dirtyBySection,
    resetSection,
  } = useEditGame();

  const tools = [
    { id: "winecfg", label: t("edit.tool.winecfg"), icon: <Settings2 size={15} /> },
    { id: "winetricks", label: "Winetricks", icon: <Wrench size={15} /> },
    { id: "regedit", label: t("edit.tool.regedit"), icon: <Terminal size={15} /> },
    { id: "control", label: t("edit.tool.control"), icon: <LayoutGrid size={15} /> },
    { id: "taskmgr", label: t("edit.tool.taskmgr"), icon: <Activity size={15} /> },
    { id: "cmd", label: t("edit.tool.cmd"), icon: <Terminal size={15} /> },
    { id: "browse_prefix", label: t("edit.tool.openPrefix"), icon: <FolderOpen size={15} /> },
  ];

  return (
    <section className="edit-section" aria-labelledby="edit-section-maintenance">
      <SectionHeader
        id="edit-section-maintenance"
        title={t("edit.section.maintenance")}
        description={t("edit.section.maintenanceDesc")}
        changed={dirtyBySection.maintenance}
        onReset={() => resetSection("maintenance")}
      />

      <Disclosure>
      <SettingCard
        id="compat-maintenance"
        title={t("gameEdit.compatibility.maintenanceTools")}
        description={t("gameEdit.compatibility.maintenanceDesc")}
      >
        <div className="edit-tool-grid">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="edit-tool"
              onClick={() => handleRunWineTool(tool.id)}
              disabled={runningTool !== null}
            >
              {tool.icon}
              <span>{tool.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="edit-tool edit-tool--danger"
            onClick={() => handleRunWineTool("kill")}
            disabled={runningTool !== null}
          >
            <CircleX size={15} />
            <span>{t("edit.tool.kill")}</span>
          </button>
        </div>
      </SettingCard>
      </Disclosure>
    </section>
  );
}
