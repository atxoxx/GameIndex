import { describe, it, expect } from "vitest";
import {
  installModeHintKey,
  installModeLabelKey,
  isInstallMode,
  isPluginManaged,
} from "./UpdateContext";

describe("isInstallMode", () => {
  it("accepts every known install mode", () => {
    for (const mode of ["nsis", "portable", "appimage", "deb", "dev", "unsupported"]) {
      expect(isInstallMode(mode)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isInstallMode("rpm")).toBe(false);
    expect(isInstallMode(null)).toBe(false);
    expect(isInstallMode(42)).toBe(false);
  });
});

describe("isPluginManaged", () => {
  it("routes installed bundles through the updater plugin", () => {
    expect(isPluginManaged("nsis")).toBe(true);
    expect(isPluginManaged("appimage")).toBe(true);
    expect(isPluginManaged("deb")).toBe(true);
  });

  it("leaves portable and channel-less builds out of the plugin path", () => {
    expect(isPluginManaged("portable")).toBe(false);
    expect(isPluginManaged("dev")).toBe(false);
    expect(isPluginManaged("unsupported")).toBe(false);
  });
});

describe("installModeLabelKey", () => {
  it("maps every mode to its badge string", () => {
    expect(installModeLabelKey("portable")).toBe("updater.modePortable");
    expect(installModeLabelKey("nsis")).toBe("updater.modeInstalled");
    expect(installModeLabelKey("appimage")).toBe("updater.modeAppImage");
    expect(installModeLabelKey("deb")).toBe("updater.modeDeb");
    expect(installModeLabelKey("unsupported")).toBe("updater.modeUnsupported");
    expect(installModeLabelKey("dev")).toBe("updater.modeDev");
  });
});

describe("installModeHintKey", () => {
  it("explains how each updateable mode installs", () => {
    expect(installModeHintKey("portable")).toBe("updater.portableHint");
    expect(installModeHintKey("nsis")).toBe("updater.installedHint");
    expect(installModeHintKey("appimage")).toBe("updater.appimageHint");
    expect(installModeHintKey("deb")).toBe("updater.debHint");
  });

  it("returns no hint for modes that never surface an update", () => {
    expect(installModeHintKey("dev")).toBeNull();
    expect(installModeHintKey("unsupported")).toBeNull();
  });
});
