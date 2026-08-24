import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  bookAll,
  bookWithFallback,
  searchAll,
  serializeOutcomes,
  textWithFallback,
} from "./core/all.ts";
import { requireOperation } from "./core/provider.ts";
import { listProviders } from "./core/registry.ts";
import { isAllProviders, providerArg, selectProvider } from "./core/resolve.ts";
import {
  authorInput,
  bookIdInput,
  isbnInput,
  limitInput,
  maxBytesInput,
  offsetInput,
  providerInput,
  queryInput,
  titleInput,
} from "./core/schemas.ts";
import { version } from "./version.ts";
import "./providers/index.ts";

function result(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerResult(provider: string, value: unknown): CallToolResult {
  return result({ provider, data: value });
}

/** Create an MCP server exposing the normalized book operations. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "books", version });

  server.registerTool(
    "books_providers",
    {
      description: "List registered book providers, their capabilities and credential state",
      annotations: { readOnlyHint: true },
    },
    () => result(listProviders()),
  );

  server.registerTool(
    "books_search",
    {
      description: "Find books matching a free-form query, best match first",
      inputSchema: {
        query: queryInput,
        limit: limitInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, provider }) => {
      if (isAllProviders(provider)) {
        return result(serializeOutcomes(await searchAll(query, { limit })));
      }
      const selected = selectProvider(provider, "search");
      const search = requireOperation(selected.provider, "search");
      return providerResult(selected.name, await search(query, { limit }));
    },
  );

  server.registerTool(
    "books_get",
    {
      description:
        "Fetch the bibliographic record of one book by ISBN, title, or provider id. Without a provider, catalogs are tried in order until one has it; an ISBN only reaches catalogs that can look one up.",
      inputSchema: {
        isbn: isbnInput,
        title: titleInput,
        author: authorInput,
        id: bookIdInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ isbn, title, author, id, provider }) => {
      const query = { isbn, title, author, id };
      if (isAllProviders(provider)) {
        return result(serializeOutcomes(await bookAll(query)));
      }
      if (!providerArg(provider)) {
        const fallback = await bookWithFallback(query);
        return result({
          provider: fallback.provider,
          skipped: fallback.skipped,
          data: fallback.result,
        });
      }
      const selected = selectProvider(provider);
      const book = requireOperation(selected.provider, "book");
      return providerResult(selected.name, await book(query));
    },
  );

  server.registerTool(
    "books_text",
    {
      description:
        "Read a slice of a public-domain book's text, by title or provider id. Only the public-domain libraries serve texts; the result carries nextOffset for reading on.",
      inputSchema: {
        title: titleInput,
        author: authorInput,
        id: bookIdInput,
        offset: offsetInput,
        maxBytes: maxBytesInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ title, author, id, offset, maxBytes, provider }) => {
      const query = { title, author, id };
      const options = { offset, maxBytes };
      if (!providerArg(provider)) {
        const fallback = await textWithFallback(query, options);
        return result({
          provider: fallback.provider,
          skipped: fallback.skipped,
          data: fallback.result,
        });
      }
      const selected = selectProvider(provider, "text");
      const text = requireOperation(selected.provider, "text");
      return providerResult(selected.name, await text(query, options));
    },
  );

  return server;
}
