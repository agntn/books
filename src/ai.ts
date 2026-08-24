/** Vercel AI SDK tool surface over the normalized book operations. */

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Book, BookMatch, BookText } from "./core/types.ts";
import type { SerializedOutcome } from "./core/all.ts";
import {
  bookAll,
  bookWithFallback,
  searchAll,
  serializeOutcomes,
  textWithFallback,
} from "./core/all.ts";
import { requireOperation } from "./core/provider.ts";
import { providers } from "./core/registry.ts";
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
import "./providers/index.ts";

const searchInputSchema = z.object({
  query: queryInput,
  limit: limitInput,
  ...providerInput,
});

type SearchToolOutput =
  | { provider: string; matches: BookMatch[] }
  | { comparison: SerializedOutcome<BookMatch[]>[] };

export const searchTool: Tool<z.infer<typeof searchInputSchema>, SearchToolOutput> = tool({
  description:
    "Find books matching a free-form query, best match first. Pass provider 'all' to compare every catalog.",
  inputSchema: searchInputSchema,
  execute: async ({ query, limit, provider }) => {
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await searchAll(query, { limit })) };
    }
    const selected = selectProvider(provider, "search");
    const search = requireOperation(selected.provider, "search");
    return { provider: selected.name, matches: await search(query, { limit }) };
  },
});

const bookInputSchema = z.object({
  isbn: isbnInput,
  title: titleInput,
  author: authorInput,
  id: bookIdInput,
  ...providerInput,
});

type BookToolOutput =
  | { provider: string; book: Book; skipped?: { provider: string; error: string }[] }
  | { comparison: SerializedOutcome<Book>[] };

export const bookTool: Tool<z.infer<typeof bookInputSchema>, BookToolOutput> = tool({
  description:
    "Fetch the bibliographic record of one book by ISBN, title, or provider id. Without a provider, catalogs are tried in order until one has it.",
  inputSchema: bookInputSchema,
  execute: async ({ isbn, title, author, id, provider }) => {
    const query = { isbn, title, author, id };
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await bookAll(query)) };
    }
    if (!providerArg(provider)) {
      const fallback = await bookWithFallback(query);
      return { provider: fallback.provider, book: fallback.result, skipped: fallback.skipped };
    }
    const selected = selectProvider(provider);
    const book = requireOperation(selected.provider, "book");
    return { provider: selected.name, book: await book(query) };
  },
});

const textInputSchema = z.object({
  title: titleInput,
  author: authorInput,
  id: bookIdInput,
  offset: offsetInput,
  maxBytes: maxBytesInput,
  ...providerInput,
});

export const textTool: Tool<
  z.infer<typeof textInputSchema>,
  { provider: string; text: BookText; skipped?: { provider: string; error: string }[] }
> = tool({
  description:
    "Read a slice of a public-domain book's text. Only the public-domain libraries serve texts; the result carries nextOffset for reading on.",
  inputSchema: textInputSchema,
  execute: async ({ title, author, id, offset, maxBytes, provider }) => {
    const query = { title, author, id };
    const options = { offset, maxBytes };
    if (!providerArg(provider)) {
      const fallback = await textWithFallback(query, options);
      return { provider: fallback.provider, text: fallback.result, skipped: fallback.skipped };
    }
    const selected = selectProvider(provider, "text");
    const text = requireOperation(selected.provider, "text");
    return { provider: selected.name, text: await text(query, options) };
  },
});

export const providersTool: Tool<Record<string, never>, { providers: string[] }> = tool({
  description: "List registered book provider keys accepted by the other book tools.",
  inputSchema: z.object({}),
  execute: async () => {
    return { providers: providers() };
  },
});
