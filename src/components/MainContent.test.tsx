import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import MainContent from "./MainContent";

function NavProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/game/1?tab=notes&notesItem=note-1")}>
        select note
      </button>
      <button onClick={() => navigate("/game/1?tab=reviews")}>switch tab</button>
      <button onClick={() => navigate("/library")}>leave game</button>
      <MainContent />
    </>
  );
}

function renderProbe() {
  return render(
    <MemoryRouter initialEntries={["/game/1?tab=notes"]}>
      <NavProbe />
    </MemoryRouter>,
  );
}

describe("MainContent scroll reset", () => {
  let appMain: HTMLDivElement;
  let appMainScroll: Mock<(options?: ScrollToOptions | number, y?: number) => void>;
  let windowScroll: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    appMainScroll = vi.fn((_options?: ScrollToOptions | number, _y?: number) => {});
    appMain = document.createElement("div");
    appMain.className = "app-main";
    appMain.scrollTo = appMainScroll;
    document.body.appendChild(appMain);
    windowScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    appMain.remove();
    windowScroll.mockRestore();
  });

  it("stays put when only an in-page query parameter changes", () => {
    renderProbe();
    appMainScroll.mockClear();
    windowScroll.mockClear();

    fireEvent.click(screen.getByText("select note"));

    expect(appMainScroll).not.toHaveBeenCalled();
    expect(windowScroll).not.toHaveBeenCalled();
  });

  it("returns to the top when the detail tab or route changes", () => {
    renderProbe();
    appMainScroll.mockClear();
    windowScroll.mockClear();

    fireEvent.click(screen.getByText("switch tab"));

    expect(appMainScroll).toHaveBeenCalledWith({ top: 0 });
    expect(windowScroll).toHaveBeenCalledWith(0, 0);

    appMainScroll.mockClear();
    windowScroll.mockClear();
    fireEvent.click(screen.getByText("leave game"));

    expect(appMainScroll).toHaveBeenCalledWith({ top: 0 });
    expect(windowScroll).toHaveBeenCalledWith(0, 0);
  });
});
