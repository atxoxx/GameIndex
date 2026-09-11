import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import AppContextMenu from "./AppContextMenu";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ key: "test-key", pathname: "/library" }),
}));

const setThemeMock = vi.fn();
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ currentTheme: "dark", setTheme: setThemeMock }),
}));

const setBigScreenMock = vi.fn();
vi.mock("../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: false, setBigScreen: setBigScreenMock, ready: true }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

describe("AppContextMenu", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    setThemeMock.mockClear();
    setBigScreenMock.mockClear();
    vi.mocked(openUrl).mockClear();
  });

  it("opens a custom menu on empty-area right-click", () => {
    render(<AppContextMenu />);

    fireEvent.contextMenu(document.body);
    expect(screen.getByText("Reload")).toBeInTheDocument();
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
  });

  it("keeps the native menu inside editable fields", () => {
    render(
      <>
        <input aria-label="field" />
        <AppContextMenu />
      </>
    );

    fireEvent.contextMenu(screen.getByLabelText("field"));
    expect(screen.queryByText("Reload")).not.toBeInTheDocument();
  });

  it("respects surfaces that already claimed the right-click", () => {
    render(
      <>
        <div data-testid="claimed" onContextMenu={(e) => e.preventDefault()}>
          claimed
        </div>
        <AppContextMenu />
      </>
    );

    fireEvent.contextMenu(screen.getByTestId("claimed"));
    expect(screen.queryByText("Reload")).not.toBeInTheDocument();
  });

  it("navigates through the Go to submenu", async () => {
    render(<AppContextMenu />);

    fireEvent.contextMenu(document.body);
    fireEvent.click(screen.getByText("Go to"));
    fireEvent.click(await screen.findByText("Library"));
    expect(navigateMock).toHaveBeenCalledWith("/library");
  });

  it("offers link actions when right-clicking an anchor", async () => {
    render(
      <>
        <a href="https://example.com/page">Example</a>
        <AppContextMenu />
      </>
    );

    fireEvent.contextMenu(screen.getByText("Example"));
    fireEvent.click(await screen.findByText("Open Link"));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/page");
  });

  it("toggles the theme from the menu", () => {
    render(<AppContextMenu />);

    fireEvent.contextMenu(document.body);
    fireEvent.click(screen.getByText("Toggle Theme"));
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });
});
