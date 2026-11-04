import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Value } from "typebox/value";

/** The Pi TUI is served by the harness at runtime; the tests only need a Text that captures. */
vi.mock("@earendil-works/pi-tui", () => ({
  Text: class {
    constructor(readonly text: string) {}
  },
}));
import {
  FAKE_TEXT_BYTES,
  GUTENDEX_BOOK,
  OPENLIBRARY_EDITION,
  OPENLIBRARY_WORK,
  requireTool,
  stubRoutes,
} from "../helpers.ts";
import { MAX_TEXT_BYTES } from "../../src/core/types.ts";
import booksExtension from "../../extensions/pi/books.ts";

/* SAFETY: the extension only calls registerTool during registration; the fake implements that seam. */
async function registerExtensionTools(): Promise<Map<string, ToolDefinition>> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  await booksExtension(api as unknown as ExtensionAPI);
  return tools;
}

/** SAFETY: the tested execute functions don't read ExtensionToolContext. */
const unusedContext = {} as ExtensionToolContext;

const ROUTES = {
  "/isbn/": { body: OPENLIBRARY_EDITION },
  "/works/OL893414W.json": { body: OPENLIBRARY_WORK },
  "/works/OL893414W/ratings.json": { body: { summary: { average: 4.3, count: 443 } } },
  "/authors/OL79034A.json": { body: { name: "Placeholder Herbert" } },
  "/books/84": { body: GUTENDEX_BOOK },
  "84.txt.utf-8": { body: "", bytes: FAKE_TEXT_BYTES },
};

/* Text of a tool result, which is what the model actually reads. */
function resultText(result: Readonly<{ content: readonly Readonly<{ text?: string }>[] }>): string {
  return result.content.map((part) => part.text ?? "").join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("books Pi extension", () => {
  it("registers the complete tool set", async () => {
    expect([...(await registerExtensionTools()).keys()]).toEqual([
      "books_providers",
      "books_search",
      "books_get",
      "books_text",
      "books_text_search",
      "books_text_follow",
    ]);
  });

  it("names each tool in every prompt guideline", async () => {
    for (const tool of (await registerExtensionTools()).values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it("tells the model that only public-domain books have texts", async () => {
    const tool = requireTool(await registerExtensionTools(), "books_text");
    expect(tool.promptGuidelines?.join(" ")).toMatch(/public-domain|copyright/i);
  });

  it("accepts a lookup by any one identifier and reads an empty provider as none", async () => {
    const tool = requireTool(await registerExtensionTools(), "books_get");
    const schema = tool.parameters as Parameters<typeof Value.Check>[0];

    expect(Value.Check(schema, { isbn: "9780441013593" })).toBe(true);
    expect(Value.Check(schema, { title: "Dune" })).toBe(true);
    expect(Value.Check(schema, {})).toBe(true);
    expect(Value.Check(schema, { title: "Dune", provider: "" })).toBe(true);
    expect(Value.Check(schema, { title: "Dune", saltHex: "00" })).toBe(false);
  });

  it("rejects a malformed ISBN before any request", async () => {
    const fetch = stubRoutes(ROUTES);
    const tool = requireTool(await registerExtensionTools(), "books_get");

    await expect(
      tool.execute("call-0", { isbn: "978" }, undefined, undefined, unusedContext),
    ).rejects.toThrow(/ISBN|isbn/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds a text slice at the shared ceiling", async () => {
    const tool = requireTool(await registerExtensionTools(), "books_text");
    const schema = tool.parameters as Parameters<typeof Value.Check>[0];

    // Bound taken from the library, not restated: the schema literal and MAX_TEXT_BYTES are two
    // copies of one limit, and only a behavioural check notices when they drift apart.
    expect(Value.Check(schema, { title: "Frankenstein", maxBytes: MAX_TEXT_BYTES })).toBe(true);
    expect(Value.Check(schema, { title: "Frankenstein", maxBytes: MAX_TEXT_BYTES + 1 })).toBe(
      false,
    );
    expect(Value.Check(schema, { title: "Frankenstein", offset: -1 })).toBe(false);
  });

  it("fetches a record through the library and renders it with its source", async () => {
    stubRoutes(ROUTES);
    const tool = requireTool(await registerExtensionTools(), "books_get");

    const result = await tool.execute?.(
      "call-1",
      { isbn: "9780441013593" },
      undefined,
      undefined,
      unusedContext,
    );

    const text = resultText(result as { content: { text?: string }[] });
    expect(text).toContain("Placeholder Novel");
    expect(text).toContain("Source: https://openlibrary.org/books/OL7524304M");
  });

  it("reads a text slice and shows how to read on", async () => {
    stubRoutes(ROUTES);
    const tool = requireTool(await registerExtensionTools(), "books_text");

    const result = await tool.execute?.(
      "call-2",
      { id: "84", maxBytes: 9 },
      undefined,
      undefined,
      unusedContext,
    );

    const text = resultText(result as { content: { text?: string }[] });
    expect(text).toContain("Rozdział");
    expect(text).toContain("read on from 9");
  });

  it("previews a collapsed result bounded and hands it back whole once expanded", async () => {
    const tools = await registerExtensionTools();
    for (const tool of tools.values()) expect(tool.renderResult).toBeDefined();

    const blurb = `lead ${"x".repeat(3000)}`;
    const result = { content: [{ type: "text" as const, text: blurb }], details: undefined };
    const render = requireTool(tools, "books_text").renderResult;

    const collapsed = render?.(
      result,
      { expanded: false, isPartial: false },
      {} as never,
      {} as never,
    ) as unknown as {
      text: string;
    };
    const opened = render?.(
      result,
      { expanded: true, isPartial: false },
      {} as never,
      {} as never,
    ) as unknown as {
      text: string;
    };

    expect(collapsed.text).toHaveLength(200);
    expect(collapsed.text.endsWith("…")).toBe(true);
    expect(opened.text).toBe(blurb);
  });

  it("lists providers without contacting one", async () => {
    const fetch = stubRoutes(ROUTES);
    const tool = requireTool(await registerExtensionTools(), "books_providers");

    const result = await tool.execute?.("call-3", {}, undefined, undefined, unusedContext);

    expect(resultText(result as { content: { text?: string }[] })).toContain("wolnelektury");
    expect(fetch).not.toHaveBeenCalled();
  });
});
