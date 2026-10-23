import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../context/LanguageContext";
import { DownloadHeader } from "./DownloadHeader";

function renderHeader(props: Partial<React.ComponentProps<typeof DownloadHeader>> = {}) {
  return render(
    <LanguageProvider>
      <DownloadHeader
        gameName="Crimson Desert"
        statusChip={{ label: "Ready", tone: "success" }}
        resultCount={18}
        searchProgress={null}
        onClose={() => {}}
        {...props}
      />
    </LanguageProvider>,
  );
}

describe("DownloadHeader", () => {
  it("names the game, its state and the result count", () => {
    const { container } = renderHeader();

    expect(screen.getByText("Crimson Desert")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText(/18 results/)).toBeInTheDocument();
    expect(container.querySelector(".dl-modal-status-dot--success")).toBeInTheDocument();
  });

  it("keeps the progress bar for an in-flight search only", () => {
    const { container, rerender } = renderHeader();
    expect(container.querySelector(".dl-header-progress-line")).toBeNull();

    rerender(
      <LanguageProvider>
        <DownloadHeader
          gameName="Crimson Desert"
          statusChip={{ label: "Searching", tone: "accent" }}
          resultCount={0}
          searchProgress={{ completed: 3, total: 8 }}
          onClose={() => {}}
        />
      </LanguageProvider>,
    );

    expect(container.querySelector(".dl-header-progress-line")).toBeInTheDocument();
    expect(screen.getByText("Searching")).toBeInTheDocument();
  });

  it("closes from the header button", () => {
    const onClose = vi.fn();
    renderHeader({ onClose });

    screen.getByRole("button", { name: /close/i }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
