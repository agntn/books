/**
 * Tool executors behind the book tools on every agent surface.
 *
 * Each returns the text a model reads, written by the formatters in `core/format.ts`, and the same
 * facts as structured details. An MCP client sees only the text, so every fact a follow-up call
 * needs (an id, an ISBN, the offset to read on from, the source URL) has to be in it.
 */

import type { ToolResult } from "@agntn/tools";

import {
  bookAll,
  bookWithFallback,
  searchAll,
  serializeOutcomes,
  textWithFallback,
  type SerializedOutcome,
} from "./core/all.ts";
import {
  formatBook,
  formatBookAll,
  formatBooks,
  formatFallback,
  formatProviders,
  formatSearchAll,
  formatText,
  formatTextSearch,
} from "./core/format.ts";
import { requireOperation } from "./core/provider.ts";
import { listProviders, type ProviderListing } from "./core/registry.ts";
import { isAllProviders, providerArg, selectOneProvider, selectProvider } from "./core/resolve.ts";
import type { Book, BookMatch, BookText, TextSearchResult } from "./core/types.ts";
import "./providers/index.ts";

/** Providers a fallback walk passed over, with the reason for each. */
type Skipped = { provider: string; error: string }[];

export type SearchDetails =
  | { provider: string; matches: BookMatch[] }
  | { comparison: SerializedOutcome<BookMatch[]>[] };
export type BookDetails =
  | { provider: string; book: Book; skipped?: Skipped }
  | { comparison: SerializedOutcome<Book>[] };
/** `slice`, not `text`: the AI SDK output adds the answer text as `text`. */
export type TextDetails = { provider: string; slice: BookText; skipped?: Skipped };
/** `search`, not `text`: the AI SDK output adds the answer text as `text`. */
export type TextSearchDetails = { provider: string; search: TextSearchResult };
export type ProvidersDetails = { providers: ProviderListing[] };

export interface SearchParams {
  readonly query: string;
  readonly limit?: number;
  readonly provider?: string;
}

export interface BookParams {
  readonly isbn?: string;
  readonly title?: string;
  readonly author?: string;
  readonly id?: string;
  readonly provider?: string;
}

export interface TextParams {
  readonly title?: string;
  readonly author?: string;
  readonly id?: string;
  readonly offset?: number;
  readonly maxBytes?: number;
  readonly provider?: string;
}

export interface TextSearchParams {
  readonly query: string;
  readonly book?: string;
  readonly page?: number;
  readonly limit?: number;
  readonly maxPages?: number;
  readonly provider?: string;
}

/**
 * Reads a blank optional argument as absent, since a host may fill every optional field with "".
 *
 * @param value - The argument as passed.
 * @returns {string | undefined} The trimmed value, or `undefined` when blank.
 */
function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/**
 * Wraps the formatted text and its details as a tool result.
 *
 * @param text - What the model reads.
 * @param details - The same facts, structured.
 * @returns {ToolResult<Details>} The result.
 */
function answer<Details>(text: string, details: Details): ToolResult<Details> {
  return { content: [{ type: "text", text }], details };
}

/**
 * Finds books matching a free-form query on one provider, or compares every provider.
 *
 * @param params - Query, result limit and provider.
 * @returns {Promise<ToolResult<SearchDetails>>} The matches.
 */
export async function booksSearch(params: SearchParams): Promise<ToolResult<SearchDetails>> {
  const query = params.query.trim();
  const options = { limit: params.limit };
  if (isAllProviders(params.provider)) {
    const outcomes = await searchAll(query, options);
    return answer(formatSearchAll(query, outcomes), { comparison: serializeOutcomes(outcomes) });
  }
  const { name, provider } = selectProvider(providerArg(params.provider), "search");
  const matches = await requireOperation(provider, "search")(query, options);
  return answer(formatBooks(name, query, matches), { provider: name, matches });
}

/**
 * Fetches one record from a named provider, from every provider, or from the first that has it.
 *
 * @param params - ISBN, title, author or provider id, and the provider.
 * @returns {Promise<ToolResult<BookDetails>>} The record.
 */
export async function booksGet(params: BookParams): Promise<ToolResult<BookDetails>> {
  const query = {
    isbn: optional(params.isbn),
    title: optional(params.title),
    author: optional(params.author),
    id: optional(params.id),
  };
  if (isAllProviders(params.provider)) {
    const outcomes = await bookAll(query);
    return answer(formatBookAll(outcomes), { comparison: serializeOutcomes(outcomes) });
  }
  const named = providerArg(params.provider);
  if (!named) {
    const fallback = await bookWithFallback(query);
    return answer(formatFallback(fallback, formatBook), {
      provider: fallback.provider,
      book: fallback.result,
      skipped: fallback.skipped,
    });
  }
  const { name, provider } = selectProvider(named);
  const book = await requireOperation(provider, "book")(query);
  return answer(formatBook(book), { provider: name, book });
}

/**
 * Reads a slice of a public-domain text from a named provider, or from the first that has it.
 *
 * @param params - Title, author or provider id, where to start, how much, and the provider.
 * @returns {Promise<ToolResult<TextDetails>>} The slice.
 */
export async function booksText(params: TextParams): Promise<ToolResult<TextDetails>> {
  const query = {
    title: optional(params.title),
    author: optional(params.author),
    id: optional(params.id),
  };
  const options = { offset: params.offset, maxBytes: params.maxBytes };
  const named = providerArg(params.provider);
  if (!named) {
    const fallback = await textWithFallback(query, options);
    return answer(formatFallback(fallback, formatText), {
      provider: fallback.provider,
      slice: fallback.result,
      skipped: fallback.skipped,
    });
  }
  const { name, provider } = selectProvider(named, "text");
  const slice = await requireOperation(provider, "text")(query, options);
  return answer(formatText(slice), { provider: name, slice });
}

/**
 * Finds a phrase inside scanned books, or inside one scan.
 *
 * @param params - Phrase, scan id, paging and the provider.
 * @returns {Promise<ToolResult<TextSearchDetails>>} The passages.
 */
export async function booksTextSearch(
  params: TextSearchParams,
): Promise<ToolResult<TextSearchDetails>> {
  const options = {
    book: optional(params.book),
    page: params.page,
    limit: params.limit,
    maxPages: params.maxPages,
  };
  const { name, provider } = selectOneProvider(providerArg(params.provider), "searchText");
  const search = await requireOperation(provider, "searchText")(params.query.trim(), options);
  return answer(formatTextSearch(search, options), { provider: name, search });
}

/**
 * Lists the registered providers with what each serves and whether its credential is set.
 *
 * @returns {ToolResult<ProvidersDetails>} The listing.
 */
export function booksProviders(): ToolResult<ProvidersDetails> {
  const providers = listProviders();
  return answer(formatProviders(providers), { providers });
}
