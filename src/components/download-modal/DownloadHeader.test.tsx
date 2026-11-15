import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("shows a translated subtitle line and never leaks a raw i18n key", () => {
    const { rerender } = renderHeader({ subtitle: "Available downloads" });

    expect(screen.getByText("Available downloads")).toBeInTheDocument();

    rerender(
      <LanguageProvider>
        <DownloadHeader
          gameName="Crimson Desert"
          statusChip={{ label: "Ready", tone: "success" }}
          resultCount={18}
          searchProgress={null}
          onClose={() => {}}
        />
      </LanguageProvider>,
    );

    expect(screen.queryByText("downloadModal.availableDownloads")).toBeNull();
    expect(screen.getByText("Available downloads")).toBeInTheDocument();
  });

  it("renders the source count beside the entry count when provided", () => {
    renderHeader({ sourceCount: 4 });

    expect(screen.getByText(/4\s+source\(s\)/i)).toBeInTheDocument();
    expect(document.querySelector(".dlm-header-stat--sources")).toBeInTheDocument();
  });

  it("falls back to the artwork glyph when the cover is missing or broken", () => {
    const { container, rerender } = renderHeader();

    expect(container.querySelector(".dlm-header-cover--fallback")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();

    rerender(
      <LanguageProvider>
        <DownloadHeader
          gameName="Crimson Desert"
          gameCover="https://example.test/cover.jpg"
          statusChip={{ label: "Ready", tone: "success" }}
          resultCount={18}
          searchProgress={null}
          onClose={() => {}}
        />
      </LanguageProvider>,
    );

    const cover = container.querySelector("img");
    expect(cover).toBeInTheDocument();

    fireEvent.error(cover!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".dlm-header-cover--fallback")).toBeInTheDocument();
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

    const progress = screen.getByRole("progressbar");
    expect(container.querySelector(".dl-header-progress-line")).toBeInTheDocument();
    expect(progress).toHaveAttribute("aria-valuenow", "3");
    expect(progress).toHaveAttribute("aria-valuemax", "8");
    expect(screen.getByText("Searching")).toBeInTheDocument();
  });

  it("closes from the header button", () => {
    const onClose = vi.fn();
    renderHeader({ onClose });

    const close = screen.getByRole("button", { name: /close/i });
    expect(close).toHaveAttribute("title", expect.stringContaining("Esc"));
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
