import type { ComponentType } from "react";
import {
  CheckCircle2,
  Cpu,
  Download,
  Gamepad2,
  LayoutGrid,
  Library,
  Palette,
  Power,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import WelcomeStep from "./steps/WelcomeStep";
import AppearanceStep from "./steps/AppearanceStep";
import FeaturesStep from "./steps/FeaturesStep";
import LibrariesStep from "./steps/LibrariesStep";
import HardwareStep from "./steps/HardwareStep";
import OverlayStep from "./steps/OverlayStep";
import StartupStep from "./steps/StartupStep";
import PrivacyStep from "./steps/PrivacyStep";
import DownloadsStep from "./steps/DownloadsStep";
import FinishStep from "./steps/FinishStep";

export type SetupStepId =
  | "welcome"
  | "appearance"
  | "features"
  | "libraries"
  | "stores"
  | "hardware"
  | "overlay"
  | "startup"
  | "privacy"
  | "downloads"
  | "finish";

export interface SetupStepDef {
  id: SetupStepId;
  /** Translation key for the rail label. */
  titleKey: string;
  /** Translation key for the header subtitle. */
  descKey: string;
  icon: LucideIcon;
  Component: ComponentType;
}

export const SETUP_STEPS: SetupStepDef[] = [
  { id: "welcome", titleKey: "setup.step.welcome.title", descKey: "setup.step.welcome.desc", icon: Sparkles, Component: WelcomeStep },
  { id: "appearance", titleKey: "setup.step.appearance.title", descKey: "setup.step.appearance.desc", icon: Palette, Component: AppearanceStep },
  { id: "features", titleKey: "setup.step.features.title", descKey: "setup.step.features.desc", icon: LayoutGrid, Component: FeaturesStep },
  { id: "libraries", titleKey: "setup.step.libraries.title", descKey: "setup.step.libraries.desc", icon: Library, Component: LibrariesStep },
  { id: "hardware", titleKey: "setup.step.hardware.title", descKey: "setup.step.hardware.desc", icon: Cpu, Component: HardwareStep },
  { id: "overlay", titleKey: "setup.step.overlay.title", descKey: "setup.step.overlay.desc", icon: Gamepad2, Component: OverlayStep },
  { id: "startup", titleKey: "setup.step.startup.title", descKey: "setup.step.startup.desc", icon: Power, Component: StartupStep },
  { id: "privacy", titleKey: "setup.step.privacy.title", descKey: "setup.step.privacy.desc", icon: ShieldCheck, Component: PrivacyStep },
  { id: "downloads", titleKey: "setup.step.downloads.title", descKey: "setup.step.downloads.desc", icon: Download, Component: DownloadsStep },
  { id: "finish", titleKey: "setup.step.finish.title", descKey: "setup.step.finish.desc", icon: CheckCircle2, Component: FinishStep },
];
