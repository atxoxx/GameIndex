import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SettingsSection from "./SettingsSection";
import { SettingsUiProvider, useSettingsUi } from "./SettingsUiContext";

function EssentialsToggle() {
  const { showAdvanced, setShowAdvanced } = useSettingsUi();
  return (
    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}>
      toggle
    </button>
  );
}

describe("SettingsSection", () => {
  it("always renders ordinary sections", () => {
    render(
      <SettingsUiProvider>
        <SettingsSection icon={null} title="Language">
          <p>language controls</p>
        </SettingsSection>
      </SettingsUiProvider>,
    );

    expect(screen.getByText("language controls")).toBeInTheDocument();
  });

  it("hides an advanced section while Essentials is on", () => {
    localStorage.setItem("gamelib.settings.showAdvanced", "false");
    render(
      <SettingsUiProvider>
        <SettingsSection advanced icon={null} title="Deadzones">
          <p>deadzone controls</p>
        </SettingsSection>
      </SettingsUiProvider>,
    );

    expect(screen.queryByText("deadzone controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Deadzones")).not.toBeInTheDocument();
  });

  it("reveals it again when the filter is switched off", () => {
    localStorage.setItem("gamelib.settings.showAdvanced", "false");
    render(
      <SettingsUiProvider>
        <EssentialsToggle />
        <SettingsSection advanced icon={null} title="Deadzones">
          <p>deadzone controls</p>
        </SettingsSection>
      </SettingsUiProvider>,
    );

    expect(screen.queryByText("deadzone controls")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText("deadzone controls")).toBeInTheDocument();
  });
});
