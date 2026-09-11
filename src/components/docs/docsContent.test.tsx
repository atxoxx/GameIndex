import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DOC_GROUPS,
  DOC_SECTIONS,
  DocBody,
  docReadMinutes,
  docWordCount,
} from "./docsContent";

describe("docsContent", () => {
  it("assigns every section a known group with unique ids", () => {
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
        text={"Intro paragraph.\n\n## A heading\n- First item\n  - Nested item\n- Second item"}
      />
    );
    expect(screen.getByText("Intro paragraph.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "A heading" })).toBeInTheDocument();
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByText("Nested item")).toBeInTheDocument();
    expect(screen.getByText("Second item")).toBeInTheDocument();
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

  it("estimates reading time with a one-minute floor", () => {
    expect(docReadMinutes("short text")).toBe(1);
    expect(docWordCount("one two three")).toBe(3);
    const longBody = Array.from({ length: 400 }, () => "word").join(" ");
    expect(docReadMinutes(longBody)).toBe(2);
  });
});
