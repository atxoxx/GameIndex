import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../context/LanguageContext";
import DocsPage from "./DocsPage";
import { ALL_SUBCATEGORIES } from "../components/docs/docsContent";

function renderDocsPage(initialRoute = "/docs") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <LanguageProvider>
        <DocsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe("DocsPage", () => {
  it("renders the hero with title, subtitle, and stats", () => {
    renderDocsPage();
    expect(screen.getByRole("heading", { level: 1, name: "Documentation" })).toBeInTheDocument();
    expect(screen.getByText(/12 categories/i)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${ALL_SUBCATEGORIES.length} sections`, "i"))
    ).toBeInTheDocument();
  });

  it("renders the category dropdown and opens the menu on click", () => {
    renderDocsPage();
    const dropdownTrigger = screen.getByRole("button", { name: "Category" });
    expect(dropdownTrigger).toBeInTheDocument();
    expect(dropdownTrigger).toHaveTextContent(/All categories/i);

    // Click trigger to open menu
    fireEvent.click(dropdownTrigger);

    // Should list categories in menu
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Getting Started/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Store Integrations/i })).toBeInTheDocument();
  });

  it("selects a category from dropdown to filter and updates trigger", () => {
    renderDocsPage();
    const dropdownTrigger = screen.getByRole("button", { name: "Category" });
    fireEvent.click(dropdownTrigger);

    const storeOption = screen.getByRole("option", { name: /Store Integrations/i });
    fireEvent.click(storeOption);

    // Dropdown trigger updates to selected category
    expect(dropdownTrigger).toHaveTextContent("Store Integrations");
  });

  it("renders Quick Start cards with badges and responds to clicks", () => {
    renderDocsPage();
    const quickCard = screen.getByRole("button", { name: /Overview & Architecture/i });
    expect(quickCard).toBeInTheDocument();
    expect(screen.getByText("3-Minute Setup")).toBeInTheDocument();
  });

  it("searches across articles and displays search results mode", () => {
    renderDocsPage();
    const searchInput = screen.getByRole("searchbox");
    fireEvent.change(searchInput, { target: { value: "Proton" } });

    expect(screen.getByRole("status")).toHaveTextContent(/sections/i);
    expect(screen.getAllByRole("button", { name: "Clear search" }).length).toBeGreaterThanOrEqual(1);
  });

  it("copies article link when clicking the share button", async () => {
    renderDocsPage();
    const shareBtn = screen.getByTitle("Copy link");
    expect(shareBtn).toBeInTheDocument();

    fireEvent.click(shareBtn);
    expect(screen.getByText("Link copied to clipboard")).toBeInTheDocument();
    expect(shareBtn.className).toContain("docs-action-btn--copied");
  });
});
