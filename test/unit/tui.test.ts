import { describe, expect, it } from "vite-plus/test";
import { renderToolResult } from "../../packages/shared/tui.ts";

const ESC = String.fromCodePoint(27);
const NUL = String.fromCodePoint(0);
const BEL = String.fromCodePoint(7);

/** `fg` is optional on the theme, so a bare object has to render too. */
const plain = {};

/** Mark the colour a line was painted with, so the tests can read it back. */
const tagged = { fg: (color: string, text: string) => `<${color}>${text}` };

function textResult(...lines: readonly string[]) {
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/* The shape of a text slice: a header, a byte range, a blank line, then pages of prose. */
function sliceResult(paragraphs: number, width: number) {
  const prose = Array.from(
    { length: paragraphs },
    (_, index) => `${"p".repeat(width)} ${index + 1}`,
  );
  return textResult(
    "[gutendex] Placeholder Novel - Placeholder Herbert",
    "Bytes 0-32768",
    "",
    ...prose,
  );
}

describe("collapsed previews", () => {
  it("cuts a blurb that arrives as one endless line down to the preview width", () => {
    const rendered = renderToolResult(textResult("b".repeat(10_000)), {}, plain);

    expect(rendered).toHaveLength(200);
    expect(rendered.endsWith("…")).toBe(true);
  });

  it("leaves a record that already fits alone", () => {
    const record = textResult("[gutendex] Placeholder Novel", "Pages: 412");

    expect(renderToolResult(record, {}, plain)).toBe("[gutendex] Placeholder Novel\nPages: 412");
  });

  it("shows ten lines of a slice and counts the rest", () => {
    const lines = renderToolResult(sliceResult(20, 500), {}, plain).split("\n");

    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("[gutendex] Placeholder Novel - Placeholder Herbert");
    expect(lines[10]).toBe("… 13 more lines");
    expect(lines[5]).toHaveLength(200);
  });

  it("paints the prose and the hidden-line count differently", () => {
    const lines = renderToolResult(sliceResult(20, 4), {}, tagged).split("\n");

    expect(lines[0]).toBe("<toolOutput>[gutendex] Placeholder Novel - Placeholder Herbert");
    expect(lines[10]).toBe("<muted>… 13 more lines");
  });

  it("does not spend a preview line on the break a slice ends with", () => {
    const rendered = renderToolResult(textResult("last words of the slice", ""), {}, plain);

    expect(rendered).toBe("last words of the slice");
  });
});

describe("expanded results", () => {
  it("keeps the complete text of every line", () => {
    const lines = renderToolResult(sliceResult(20, 500), { expanded: true }, plain).split("\n");

    expect(lines).toHaveLength(23);
    expect(lines[4]).toHaveLength(502);
    expect(lines.at(-1)).not.toContain("more lines");
  });

  it("keeps a paragraph longer than the collapsed scan width", () => {
    const paragraph = "z".repeat(10_000);

    expect(renderToolResult(textResult(paragraph), { expanded: true }, plain)).toBe(paragraph);
  });
});

describe("untrusted catalog text", () => {
  it("strips the terminal control bytes a downloaded file can carry", () => {
    const rendered = renderToolResult(
      textResult(`${ESC}[31mred${ESC}]0;title${BEL}${NUL}text`),
      {},
      plain,
    );

    expect(rendered).toBe("red text");
  });

  it("strips them in the expanded view as well", () => {
    expect(renderToolResult(textResult(`${ESC}[31mred`), { expanded: true }, plain)).toBe("red");
  });

  it("cuts before a surrogate pair rather than through it", () => {
    const rendered = renderToolResult(textResult(`${"a".repeat(198)}😀tail`), {}, plain);

    expect(rendered).toBe(`${"a".repeat(198)}…`);
  });
});

describe("result shapes", () => {
  it("renders nothing for a result with no text", () => {
    expect(renderToolResult({ content: [] }, {}, plain)).toBe("");
    expect(renderToolResult({}, {}, plain)).toBe("");
  });

  it("skips content parts that carry no text", () => {
    const result = {
      content: [{ type: "image", data: "AAAA" }, { type: "text", text: "kept" }, null],
    };

    expect(renderToolResult(result, {}, plain)).toBe("kept");
  });
});
