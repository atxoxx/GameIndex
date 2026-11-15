import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { WineLogsTerminal } from "./WineLogsTerminal";
import { filterLines } from "./logAnalysis";

const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn(async () => true) }));

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../utils/clipboard", () => ({ copyTextToClipboard: copyMock }));

const LINES = [
  "=== GameIndex Compatibility Log ===",
  "info: starting game",
  "err: failed to load d3d11",
  "warn: shader cache miss",
  "dxvk: pipeline created",
];

const rows = filterLines(LINES, "all", "");

function renderTerminal(overrides: { wrap?: boolean; query?: string } = {}) {
  return render(
    <WineLogsTerminal
      rows={rows}
      query={overrides.query ?? ""}
      wrap={overrides.wrap ?? false}
      autoScroll={false}
      activeIndex={null}
      ariaLabel="wine logs"
    />
  );
}

describe("WineLogsTerminal", () => {
  it("renders one row per visible line with its severity class", () => {
    renderTerminal();

    const rendered = Array.from(document.querySelectorAll(".wine-logs-row"));
    expect(rendered).toHaveLength(rows.length);
    expect(rendered[0]).toHaveClass("wine-logs-row--header");
    expect(rendered[2]).toHaveClass("wine-logs-row--error");
    expect(rendered[3]).toHaveClass("wine-logs-row--warning");
    expect(rendered[4]).toHaveClass("wine-logs-row--system");
    expect(rendered[1]).toHaveClass("wine-logs-row--info");
  });

  it("wraps only when the wrap prop is on", () => {
    const { rerender } = renderTerminal();
    const terminal = document.querySelector(".wine-logs-terminal");
    expect(terminal).not.toHaveClass("is-wrapped");
    expect(terminal).toHaveAttribute("data-wrap", "false");

    rerender(
      <WineLogsTerminal
        rows={rows}
        query=""
        wrap
        autoScroll={false}
        activeIndex={null}
        ariaLabel="wine logs"
      />
    );

    expect(document.querySelector(".wine-logs-terminal")).toHaveClass("is-wrapped");
    expect(document.querySelector(".wine-logs-terminal")).toHaveAttribute("data-wrap", "true");
  });

  it("marks the matched substring of a search", () => {
    renderTerminal({ query: "dxvk" });

    const marks = Array.from(document.querySelectorAll("mark.wine-logs-mark"));
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("dxvk");
  });

  it("copies a line through the clipboard helper", async () => {
    copyMock.mockClear();
    renderTerminal();

    const firstRowCopy = document.querySelector<HTMLButtonElement>(".wine-logs-row-copy");
    expect(firstRowCopy).not.toBeNull();
    fireEvent.click(firstRowCopy!);

    await waitFor(() => {
      expect(copyMock).toHaveBeenCalledWith(LINES[0]);
    });
  });
});
