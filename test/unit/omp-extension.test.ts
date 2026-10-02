import { ToolInputError, wireSchema } from "@agntn/tools";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Compiled OMP injects no TUI barrel, so loading it has to fail the test. */
vi.mock("@oh-my-pi/pi-coding-agent/tui", () => {
  throw new Error("The OMP host does not inject the TUI barrel");
});

import {
  FAKE_TEXT_BYTES,
  GUTENDEX_BOOK,
  OPENLIBRARY_EDITION,
  OPENLIBRARY_WORK,
  requireTool,
  stubRoutes,
} from "../helpers.ts";
import { MAX_TEXT_BYTES } from "../../src/core/types.ts";
import { bookTools } from "../../src/tools.ts";
import booksOmpExtension from "../../packages/omp/extensions/books.ts";

interface RegisteredExtension {
  label: string | undefined;
  tools: Map<string, ToolDefinition>;
}

/** The adapter only wraps the JSON Schema in `Type.Unsafe`; this hands it back as it came. */
const typebox = { Type: { Unsafe: (schema: unknown) => schema } };

/** Stands in for the host `Text`: it keeps the line, so a renderer test reads what was drawn. */
class CapturedText {
  constructor(
    readonly text: string,
    readonly paddingX?: number,
    readonly paddingY?: number,
  ) {}
}

/** A theme that writes its styling calls into the output. */
const theme = {
  fg: (color: string, text: string) => `${color}(${text})`,
  styledSymbol: (symbol: string, color: string) => `${color}:${symbol}`,
  spinnerFrames: ["frame-0", "frame-1"],
  format: { bracketLeft: "[", bracketRight: "]" },
  sep: { dot: " | " },
} as unknown as Theme;

/** SAFETY: the test host implements the registration-time capabilities the extension uses. */
async function registerExtensionTools(): Promise<RegisteredExtension> {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    typebox,
    pi: { Text: CapturedText },
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  await booksOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

/**
 * Runs a tool and reports whether the core refused its arguments. The schema check runs in
 * `execute`, before the executor, so a refusal never reaches a catalog.
 */
async function outcome(tool: ToolDefinition, params: unknown): Promise<string> {
  return Promise.resolve(
    tool.execute("call-0", params as never, undefined, undefined, unusedContext),
  ).then(
    () => "ran",
    (error: unknown) => (error instanceof ToolInputError ? "refused" : "failed"),
  );
}

/** Text of a status line the host would draw for these arguments. */
function statusLine(tool: ToolDefinition, args: Record<string, unknown>): string {
  if (!tool.renderCall) throw new Error(`${tool.name} has no call renderer`);
  const rendered = tool.renderCall(args, { expanded: false, isPartial: false }, theme);
  return (rendered as unknown as { text: string }).text;
}

const ROUTES = {
  "/isbn/": { body: OPENLIBRARY_EDITION },
  "/works/OL893414W.json": { body: OPENLIBRARY_WORK },
  "/works/OL893414W/ratings.json": { body: { summary: { average: 4.3, count: 443 } } },
  "/authors/OL79034A.json": { body: { name: "Placeholder Herbert" } },
  "/books/84": { body: GUTENDEX_BOOK },
  "84.txt.utf-8": { body: "", bytes: FAKE_TEXT_BYTES },
};

function resultText(result: { content: { text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("books OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", async () => {
    const { label, tools } = await registerExtensionTools();

    expect(label).toBe("Books");
    expect([...tools.keys()]).toEqual([
      "books_providers",
      "books_search",
      "books_get",
      "books_text",
      "books_text_search",
    ]);
    expect([...tools.values()].every((tool) => tool.approval === "read")).toBe(true);
  });

  /** A blank provider means no preference, and the byte ceiling is the library's own. */
  it("hands OMP the shared schemas and refuses what they reject", async () => {
    stubRoutes(ROUTES);
    const { tools } = await registerExtensionTools();
    const get = requireTool(tools, "books_get");
    const text = requireTool(tools, "books_text");
    const search = requireTool(tools, "books_search");

    for (const definition of bookTools) {
      expect(requireTool(tools, definition.name).parameters).toEqual(wireSchema(definition));
    }
    expect(await outcome(get, { isbn: "9780441013593" })).toBe("ran");
    expect(await outcome(get, { title: "Dune", provider: "" })).not.toBe("refused");
    expect(await outcome(get, { title: "Dune", saltHex: "00" })).toBe("refused");
    expect(await outcome(text, { id: "84", maxBytes: MAX_TEXT_BYTES })).toBe("ran");
    expect(await outcome(text, { id: "84", maxBytes: MAX_TEXT_BYTES + 1 })).toBe("refused");
    expect(await outcome(search, {})).toBe("refused");
  });

  it("strips escape sequences a model or a catalog could put in a status line", async () => {
    const tool = requireTool((await registerExtensionTools()).tools, "books_get");

    expect(statusLine(tool, { title: "Dune\u001b]0;evil\u0007\u001b[31m\u0000  title" })).toBe(
      "success:status.done accent(Books Get): muted(Dune title)",
    );
  });

  it("cuts a long argument before sanitizing it", async () => {
    const tool = requireTool((await registerExtensionTools()).tools, "books_search");
    const started = performance.now();

    statusLine(tool, { query: "\u001b]".repeat(100_000) });

    expect(performance.now() - started).toBeLessThan(500);
  });

  it("renders a status line naming the book being looked up", async () => {
    const tool = requireTool((await registerExtensionTools()).tools, "books_get");

    const rendered = tool.renderCall?.(
      { isbn: "9780441013593" },
      { expanded: false, isPartial: false },
      theme,
    ) as unknown as { text: string };

    expect(rendered.text).toBe("success:status.done accent(Books Get): muted(9780441013593)");
  });

  it("previews a collapsed result bounded and hands it back whole once expanded", async () => {
    const { tools } = await registerExtensionTools();
    for (const tool of tools.values()) expect(tool.renderResult).toBeDefined();

    const blurb = `lead ${"x".repeat(3000)}`;
    const result = { content: [{ type: "text" as const, text: blurb }], details: undefined };
    const render = requireTool(tools, "books_text").renderResult;

    const collapsed = render?.(
      result,
      { expanded: false, isPartial: false },
      {} as never,
    ) as unknown as { text: string };
    const opened = render?.(
      result,
      { expanded: true, isPartial: false },
      {} as never,
    ) as unknown as { text: string };

    expect(collapsed.text).toHaveLength(200);
    expect(collapsed.text.endsWith("…")).toBe(true);
    expect(opened.text).toBe(blurb);
  });

  it("keeps line breaks in a text slice and draws it without control bytes", async () => {
    stubRoutes(ROUTES);
    const tool = requireTool((await registerExtensionTools()).tools, "books_text");

    const result = (await tool.execute?.(
      "call-1",
      { id: "84", maxBytes: 64 },
      undefined,
      undefined,
      unusedContext,
    )) as { content: { text?: string }[] };

    expect(resultText(result)).toContain("Rozdział pierwszy.");
    const render = tool.renderResult;
    if (!render) throw new Error("books_text has no result renderer");
    const drawn = (
      render(result as never, { expanded: true, isPartial: false }, theme) as unknown as {
        text: string;
      }
    ).text;
    expect(drawn).toContain("\n");
    expect(drawn).toContain("Rozdział pierwszy.");
    expect(drawn.replace(/\n/g, "")).not.toMatch(/\p{Cc}/u);
  });

  it("fetches a record through the library", async () => {
    stubRoutes(ROUTES);
    const tool = requireTool((await registerExtensionTools()).tools, "books_get");

    const result = (await tool.execute?.(
      "call-2",
      { isbn: "9780441013593" },
      undefined,
      undefined,
      unusedContext,
    )) as { content: { text?: string }[] };

    expect(resultText(result)).toContain("Placeholder Novel");
  });
});
