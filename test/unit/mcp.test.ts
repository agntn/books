import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import type { Book, ProviderCapabilities } from "../../src/core/types.ts";
import { createMcpServer } from "../../src/mcp.ts";
import "../../src/providers/index.ts";
import { OPENLIBRARY_EDITION, OPENLIBRARY_WORK, stubRoutes } from "../helpers.ts";

const openLibraryConstructor = create("openlibrary").constructor as ProviderConstructor;
const openLibraryDefaultURL = getDefaultURL("openlibrary");

const ROUTES = {
  "/search.json": {
    body: {
      numFound: 1,
      docs: [{ key: "/works/OL893414W", title: "Placeholder Novel", author_name: ["Someone"] }],
    },
  },
  "/isbn/": { body: OPENLIBRARY_EDITION },
  "/works/OL893414W.json": { body: OPENLIBRARY_WORK },
  "/works/OL893414W/ratings.json": { body: { summary: { average: 4.3, count: 443 } } },
  "/authors/OL79034A.json": { body: { name: "Placeholder Herbert" } },
};

const openConnections: Array<{ close(): Promise<void> }> = [];

/** Takes over the openlibrary key while refusing to serve what it advertises. */
class DisabledProvider extends Provider {
  static readonly key = "openlibrary";

  get capabilities(): ProviderCapabilities {
    return { search: false, book: false, text: false, isbn: false, ratings: false };
  }

  async book(): Promise<Book> {
    throw new Error("capability gate bypassed");
  }
}

afterEach(async () => {
  register(openLibraryConstructor, openLibraryDefaultURL);
  vi.unstubAllGlobals();
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "books-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Text of a tool result, which is the only thing an MCP client sees. */
function resultText(response: unknown): string {
  const content = (response as { content?: { text?: string }[] }).content;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

describe("Books MCP server", () => {
  it("exposes every tool and answers provider discovery", async () => {
    const client = await connectTestClient();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "books_providers",
      "books_search",
      "books_get",
      "books_text",
    ]);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);

    const response = await client.callTool({ name: "books_providers", arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(resultText(response)).toContain("openlibrary");
  });

  it("searches through the selected provider", async () => {
    stubRoutes(ROUTES);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "books_search",
      arguments: { query: "placeholder", provider: "openlibrary", limit: 1 },
    });

    const text = resultText(response);
    expect(text).toContain('[openlibrary] 1 matches for "placeholder"');
    expect(text).toContain("Placeholder Novel - Someone");
    expect(text).toContain("id=OL893414W");
  });

  it("walks catalogs for a record and reports who was passed over", async () => {
    stubRoutes(ROUTES);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "books_get",
      arguments: { isbn: "9780441013593" },
    });

    const text = resultText(response);
    expect(text).toMatch(/^\[openlibrary\] Placeholder Novel/);
    expect(text).toContain("ISBN-13: 9780441013593");
    expect(text).toContain("Source: https://openlibrary.org/");
    expect(text).not.toContain("skipped");
  });

  it("rejects arguments before they reach a provider", async () => {
    const fetch = stubRoutes(ROUTES);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "books_search",
      arguments: { query: "   " },
    });

    expect(response.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a provider failure as a tool error rather than a crash", async () => {
    stubRoutes({ nothing: { body: {} } });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "books_get",
      arguments: { isbn: "9780441013593", provider: "openlibrary" },
    });

    expect(response.isError).toBe(true);
    expect(resultText(response)).toContain("Not found");
  });

  it("honours the capability gate of a provider registered by the host", async () => {
    register(DisabledProvider as unknown as ProviderConstructor);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "books_get",
      arguments: { title: "placeholder", provider: "openlibrary" },
    });

    expect(response.isError).toBe(true);
    expect(resultText(response)).toContain("not supported by openlibrary");
  });

  it("refuses an unknown provider by name", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "books_search",
      arguments: { query: "placeholder", provider: "goodreads" },
    });

    expect(response.isError).toBe(true);
    expect(resultText(response)).toContain("Unknown provider: goodreads");
  });
});
