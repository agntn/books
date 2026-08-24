import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import {
  FAKE_TEXT_BYTES,
  GUTENDEX_BOOK,
  OPENLIBRARY_EDITION,
  OPENLIBRARY_WORK,
  requireTool,
  stubRoutes,
} from "../helpers.ts";
import { MAX_TEXT_BYTES } from "../../src/core/types.ts";
import booksExtension from "../../packages/pi/extensions/books.ts";

/** SAFETY: the extension only calls registerTool during registration; the fake implements that seam. */
function registerExtensionTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  booksExtension(api as unknown as ExtensionAPI);
  return tools;
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

const ROUTES = {
  "/isbn/": { body: OPENLIBRARY_EDITION },
  "/works/OL893414W.json": { body: OPENLIBRARY_WORK },
  "/works/OL893414W/ratings.json": { body: { summary: { average: 4.3, count: 443 } } },
  "/authors/OL79034A.json": { body: { name: "Placeholder Herbert" } },
  "/books/84": { body: GUTENDEX_BOOK },
  "84.txt.utf-8": { body: "", bytes: FAKE_TEXT_BYTES },
};

/** Text of a tool result, which is what the model actually reads. */
function resultText(result: { content: { text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("books Pi extension", () => {
  it("registers the complete tool set", () => {
    expect([...registerExtensionTools().keys()]).toEqual([
      "books_get",
      "books_search",
      "books_text",
      "books_providers",
    ]);
  });

  it("names each tool in every prompt guideline", () => {
    for (const tool of registerExtensionTools().values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it("tells the model that only public-domain books have texts", () => {
    const tool = requireTool(registerExtensionTools(), "books_text");
    expect(tool.promptGuidelines?.join(" ")).toMatch(/public-domain|copyright/i);
  });

  it("accepts a lookup by any one identifier and rejects an empty provider", () => {
    const tool = requireTool(registerExtensionTools(), "books_get");
    const schema = tool.parameters as Parameters<typeof Value.Check>[0];

    expect(Value.Check(schema, { isbn: "9780441013593" })).toBe(true);
    expect(Value.Check(schema, { title: "Dune" })).toBe(true);
    expect(Value.Check(schema, {})).toBe(true);
    expect(Value.Check(schema, { title: "Dune", provider: "" })).toBe(false);
    expect(Value.Check(schema, { isbn: "978" })).toBe(false);
  });

  it("bounds a text slice at the shared ceiling", () => {
    const tool = requireTool(registerExtensionTools(), "books_text");
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
    const tool = requireTool(registerExtensionTools(), "books_get");

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
    const tool = requireTool(registerExtensionTools(), "books_text");

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

  it("lists providers without contacting one", async () => {
    const fetch = stubRoutes(ROUTES);
    const tool = requireTool(registerExtensionTools(), "books_providers");

    const result = await tool.execute?.("call-3", {}, undefined, undefined, unusedContext);

    expect(resultText(result as { content: { text?: string }[] })).toContain("wolnelektury");
    expect(fetch).not.toHaveBeenCalled();
  });
});
