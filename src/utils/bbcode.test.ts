import { describe, expect, it } from "vitest";
import {
  bbNodesToText,
  parseBbCode,
  readTag,
  safeHttpUrl,
  type BbNode,
} from "./bbcode";

function tagNodes(nodes: BbNode[], tag: string) {
  return nodes.filter(
    (node): node is Extract<BbNode, { type: "tag" }> =>
      node.type === "tag" && node.tag === tag,
  );
}

function textOf(nodes: BbNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "br") return "\n";
      return textOf(node.children);
    })
    .join("");
}

describe("parseBbCode — Steam lists", () => {
  it("starts a new item at every [*] without needing [/*]", () => {
    const nodes = parseBbCode("[list][*]one[*]two[*]three[/list]");
    const lists = tagNodes(nodes, "list");
    expect(lists).toHaveLength(1);

    const items = tagNodes(lists[0].children, "*");
    expect(items).toHaveLength(3);
    expect(items.map((item) => textOf(item.children))).toEqual(["one", "two", "three"]);
  });

  it("supports ordered lists and keeps text before the first item", () => {
    const nodes = parseBbCode("[olist]intro[*]first[*]second[/olist]");
    const lists = tagNodes(nodes, "olist");
    expect(lists).toHaveLength(1);
    expect(textOf(lists[0].children)).toContain("intro");
    expect(tagNodes(lists[0].children, "*")).toHaveLength(2);
  });

  it("nests lists inside list items", () => {
    const nodes = parseBbCode("[list][*]outer[list][*]inner a[*]inner b[/list][*]second[/list]");
    const outer = tagNodes(nodes, "list")[0];
    const outerItems = tagNodes(outer.children, "*");
    expect(outerItems).toHaveLength(2);

    const nested = tagNodes(outerItems[0].children, "list");
    expect(nested).toHaveLength(1);
    expect(tagNodes(nested[0].children, "*")).toHaveLength(2);
    expect(textOf(outerItems[1].children)).toBe("second");
  });

  it("closes an item at EOF", () => {
    const nodes = parseBbCode("[list][*]only");
    const items = tagNodes(tagNodes(nodes, "list")[0].children, "*");
    expect(items).toHaveLength(1);
    expect(textOf(items[0].children)).toBe("only");
  });
});

describe("parseBbCode — escapes and unknown tags", () => {
  it("keeps escaped brackets as literal text", () => {
    const nodes = parseBbCode("Use \\[b] for bold and \\[/b] to close.");
    expect(textOf(nodes)).toBe("Use [b] for bold and [/b] to close.");
    expect(tagNodes(nodes, "b")).toHaveLength(0);
  });

  it("unwraps a paired unknown tag to its children", () => {
    const nodes = parseBbCode("[mystery]hidden content[/mystery]");
    const unknown = tagNodes(nodes, "mystery");
    expect(unknown).toHaveLength(1);
    expect(textOf(unknown[0].children)).toBe("hidden content");
  });

  it("leaves an unpaired unknown tag visible", () => {
    const nodes = parseBbCode("a [citation] b");
    expect(nodes.every((node) => node.type === "text")).toBe(true);
    expect(textOf(nodes)).toBe("a [citation] b");
  });

  it("does not parse BBCode inside [code] and [noparse]", () => {
    const code = parseBbCode("[code][b]not bold[/b][/code]");
    expect(textOf(code)).toBe("[b]not bold[/b]");

    const noparse = parseBbCode("[noparse][list][*]x[/list][/noparse]");
    expect(textOf(noparse)).toBe("[list][*]x[/list]");
  });
});

describe("parseBbCode — regular tags", () => {
  it("parses inline formatting, headings, quotes and links", () => {
    const nodes = parseBbCode(
      "[h1]Title[/h1][b]bold[/b] [i]italic[/i] [u]under[/u] [s]gone[/s] " +
        "[url=https://example.com]site[/url][quote=Ana]quoted[/quote]",
    );
    expect(tagNodes(nodes, "h1")).toHaveLength(1);
    expect(tagNodes(nodes, "b")).toHaveLength(1);
    expect(tagNodes(nodes, "i")).toHaveLength(1);
    expect(tagNodes(nodes, "u")).toHaveLength(1);
    expect(tagNodes(nodes, "s")).toHaveLength(1);
    expect(tagNodes(nodes, "url")[0].attrs?.href).toBe("https://example.com");
    expect(tagNodes(nodes, "quote")[0].attrs?.value).toBe("Ana");
  });

  it("reads a previewyoutube value with its ;full suffix", () => {
    const match = readTag("[previewyoutube=dQw4w9WgXcQ;full]", 0);
    expect(match?.tag).toBe("previewyoutube");
    expect(match?.attrs?.value).toBe("dQw4w9WgXcQ;full");
  });
});

describe("bbcode helpers", () => {
  it("flattens nodes into readable text", () => {
    const nodes = parseBbCode("[b]Hello[/b][list][*]one[*]two[/list]");
    expect(bbNodesToText(nodes)).toContain("Hello");
    expect(bbNodesToText(nodes)).toContain("one");
    expect(bbNodesToText(nodes)).toContain("two");
  });

  it("only accepts http(s) urls", () => {
    expect(safeHttpUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(safeHttpUrl("//cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
  });
});
