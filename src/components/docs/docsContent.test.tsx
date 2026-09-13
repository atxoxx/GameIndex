import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DOC_CATEGORIES,
  ALL_SUBCATEGORIES,
  DOC_GROUPS,
  DOC_SECTIONS,
  DocBody,
  docReadMinutes,
  docWordCount,
  extractHeadings,
} from "./docsContent";

describe("docsContent", () => {
  it("defines 12 structured categories with unique subcategories", () => {
    expect(DOC_CATEGORIES.length).toBe(12);
    const catIds = DOC_CATEGORIES.map((c) => c.id);
    expect(new Set(catIds).size).toBe(catIds.length);

    const subIds = ALL_SUBCATEGORIES.map((s) => s.id);
    expect(new Set(subIds).size).toBe(subIds.length);
    expect(ALL_SUBCATEGORIES.length).toBeGreaterThanOrEqual(36);

    for (const cat of DOC_CATEGORIES) {
      expect(cat.title).toBeTruthy();
      expect(cat.description).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.subcategories.length).toBeGreaterThan(0);
    }
  });

  it("assigns every section a known group with unique ids for backward compatibility", () => {
    const ids = DOC_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of DOC_SECTIONS) {
      expect(DOC_GROUPS).toContain(section.group);
      expect(section.icon).toBeTruthy();
    }
  });

  it("renders paragraphs, subheads, bullets and nested bullets", () => {
    render(
      <DocBody
        text={"Intro paragraph.\n\n## A heading\n### Subheading\n- First item\n  - Nested item\n- Second item"}
      />
    );
    expect(screen.getByText("Intro paragraph.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A heading" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Subheading" })).toBeInTheDocument();
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByText("Nested item")).toBeInTheDocument();
    expect(screen.getByText("Second item")).toBeInTheDocument();
  });

  it("renders step headers when formatted with Step N", () => {
    render(
      <DocBody
        text={"### Step 1: Connect Account\nFollow the instructions."}
      />
    );
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Connect Account" })).toBeInTheDocument();
  });

  it("renders callouts, code, keyboard chips and external links", () => {
    render(
      <DocBody
        text={"> **Tip:** press `Ctrl+K` at [the docs](https://example.com) or hit F11."}
      />
    );
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Ctrl+K").tagName).toBe("CODE");
    expect(screen.getByText("F11").tagName).toBe("KBD");
  });

  it("extracts headings from markdown for in-page TOC", () => {
    const md = "## Introduction\nSome text\n### Step 1: Setup\nMore text\n## Details";
    const headings = extractHeadings(md);
    expect(headings).toEqual([
      { id: "introduction", title: "Introduction", level: 2 },
      { id: "step-1-setup", title: "Step 1: Setup", level: 3 },
      { id: "details", title: "Details", level: 2 },
    ]);
  });

  it("estimates reading time with a one-minute floor", () => {
    expect(docReadMinutes("short text")).toBe(1);
    expect(docWordCount("one two three")).toBe(3);
    const longBody = Array.from({ length: 400 }, () => "word").join(" ");
    expect(docReadMinutes(longBody)).toBe(2);
  });
});
