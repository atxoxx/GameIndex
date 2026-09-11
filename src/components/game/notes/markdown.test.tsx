import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import Markdown, { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  it("classifies headings, lists, tasks, quotes and code fences", () => {
    const blocks = parseBlocks(
      [
        "# Title",
        "",
        "Paragraph line",
        "continued",
        "",
        "- bullet",
        "- bullet 2",
        "",
        "- [ ] todo",
        "- [x] done",
        "",
        "1. first",
        "2. second",
        "",
        "> quoted",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );

    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "tasks",
      "list",
      "quote",
      "code",
      "hr",
    ]);
    expect(blocks[3]).toEqual({
      kind: "tasks",
      items: [
        { text: "todo", done: false },
        { text: "done", done: true },
      ],
    });
  });

  it("does not treat fenced content as Markdown blocks", () => {
    const blocks = parseBlocks("```\n# not a heading\n- not a list\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "code",
      lang: "",
      lines: ["# not a heading", "- not a list"],
    });
  });
});

describe("Markdown", () => {
  it("renders inline emphasis, links and inline code", () => {
    const { container } = render(
      <Markdown text={"**bold** and *italic* with `code` and [link](https://example.com)"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  });

  it("renders task checkboxes with the right checked state", () => {
    const { container } = render(<Markdown text={"- [x] done\n- [ ] open"} />);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it("shows raw HTML as text instead of executing it", () => {
    const { container } = render(
      <Markdown text={'<script>window.__pwned = true</script>\n<img src=x onerror="alert(1)">'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.textContent).toContain("window.__pwned = true");
  });

  it("renders fenced code as a pre block", () => {
    const { container } = render(<Markdown text={"```\nconst x = 1\n```"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("const x = 1");
  });

  it("renders non-web link schemes as plain text", () => {
    const { container, getByText } = render(<Markdown text={"[run](steam://run/123)"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(getByText("run (steam://run/123)")).toBeInTheDocument();
  });
});
