import * as TypeBox from "@oh-my-pi/omptype/typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The host serves these modules to loaded extensions at runtime; under vitest the renderers are
 * exercised against capturing stand-ins instead of the OMP TUI.
 */
vi.mock("@oh-my-pi/pi-coding-agent", () => ({
  Text: class {
    constructor(
      readonly text: string,
      readonly paddingX?: number,
      readonly paddingY?: number,
    ) {}
  },
}));
vi.mock("@oh-my-pi/pi-coding-agent/tui", () => ({
  renderStatusLine: (options: unknown) => JSON.stringify(options),
}));

import {
  FAKE_TEXT_BYTES,
  GUTENDEX_BOOK,
  OPENLIBRARY_EDITION,
  OPENLIBRARY_WORK,
  requireTool,
  stubRoutes,
} from "../helpers.ts";
import booksOmpExtension, { sanitizeTerminalText } from "../../packages/omp/extensions/books.ts";

interface RegisteredExtension {
  label: string | undefined;
  tools: Map<string, ToolDefinition>;
}

/** SAFETY: the test host implements the three registration-time capabilities the extension uses. */
function registerExtensionTools(): RegisteredExtension {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    typebox: TypeBox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  booksOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

/** SAFETY: the test host injects OMP's TypeBox facade, which creates this schema. */
function accepts(tool: ToolDefinition, value: unknown): boolean {
  return (tool.parameters as unknown as TypeBox.TSchema).safeParse(value).success;
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

function resultText(result: { content: { text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("books OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", () => {
    const { label, tools } = registerExtensionTools();

    expect(label).toBe("Books");
    expect([...tools.keys()]).toEqual([
      "books_get",
      "books_search",
      "books_text",
      "books_providers",
    ]);
    expect([...tools.values()].every((tool) => tool.approval === "read")).toBe(true);
  });

  it("validates arguments with the host's own TypeBox build", () => {
    const { tools } = registerExtensionTools();

    expect(accepts(requireTool(tools, "books_get"), { isbn: "9780441013593" })).toBe(true);
    expect(accepts(requireTool(tools, "books_get"), { title: "Dune", provider: "" })).toBe(false);
    expect(accepts(requireTool(tools, "books_text"), { title: "x", maxBytes: 262_145 })).toBe(
      false,
    );
    expect(accepts(requireTool(tools, "books_search"), { query: "dune", limit: 2 })).toBe(true);
    expect(accepts(requireTool(tools, "books_search"), {})).toBe(false);
  });

  it("strips escape sequences a model or a catalog could put in a status line", () => {
    // renderCall interpolations reach the terminal unchanged; a title carrying an OSC sequence
    // would otherwise be executed by it rather than shown.
    const hostile = "Dune\u001b[31m\u0007\u0000  title";
    expect(sanitizeTerminalText(hostile)).toBe("Dune title");
    expect(sanitizeTerminalText({ toString: () => "x\u001b[0my" })).toBe("xy");
  });

  it("renders a status line naming the book being looked up", () => {
    const tool = requireTool(registerExtensionTools().tools, "books_get");

    const rendered = tool.renderCall?.(
      { isbn: "9780441013593" },
      { expanded: false, isPartial: false },
      {} as never,
    ) as unknown as { text: string };

    expect(rendered.text).toContain("Books Get");
    expect(rendered.text).toContain("9780441013593");
  });

  it("keeps line breaks in a text slice while removing control bytes", async () => {
    stubRoutes(ROUTES);
    const tool = requireTool(registerExtensionTools().tools, "books_text");

    const result = (await tool.execute?.(
      "call-1",
      { id: "84", maxBytes: 64 },
      undefined,
      undefined,
      unusedContext,
    )) as { content: { text?: string }[] };

    const text = resultText(result);
    expect(text).toContain("\n");
    expect(text).toContain("Rozdział pierwszy.");
    expect(text.replace(/\n/g, "")).not.toMatch(/\p{Cc}/u);
  });

  it("fetches a record through the library", async () => {
    stubRoutes(ROUTES);
    const tool = requireTool(registerExtensionTools().tools, "books_get");

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
