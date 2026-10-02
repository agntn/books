/** Plain-text formatters shared by the CLI, MCP server, AI tools, and agent extensions. */

import type { FallbackResult, ProviderOutcome } from "./all.ts";
import type { ProviderListing } from "./registry.ts";
import type {
  Book,
  BookMatch,
  BookText,
  Rating,
  TextMatch,
  TextSearchOptions,
  TextSearchResult,
} from "./types.ts";

/** Reader score with its scale, because 8.2 means different things out of 5 and out of 10. */
export function formatRating(rating: Rating): string {
  const count = rating.count === undefined ? "" : ` from ${rating.count} ratings`;
  return `${rating.average.toFixed(2).replace(/\.?0+$/, "")}/${rating.scale}${count}`;
}

/**
 * Flatten a field that is rendered on one line.
 *
 * Catalog data is somebody else's text: a title carrying a newline would print as a second row
 * that reads exactly like a real record, in a list where every row is a book.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Comma-separated authors, or a placeholder when the provider listed none. */
function formatAuthors(authors: string[]): string {
  return authors.length > 0
    ? authors.map((author) => oneLine(author)).join(", ")
    : "unknown author";
}

/** One-line label for a book in a list of matches. */
export function formatBookLine(match: BookMatch): string {
  const details = [
    match.year !== undefined ? String(match.year) : undefined,
    match.language,
    match.isbn ? `ISBN ${match.isbn}` : undefined,
    match.rating ? formatRating(match.rating) : undefined,
    match.id !== undefined ? `id=${match.id}` : undefined,
    match.url,
  ].filter(Boolean);
  const tail = details.length > 0 ? `  (${details.join(", ")})` : "";
  return `${oneLine(match.title)} - ${formatAuthors(match.authors)}${tail}`;
}

/** Multi-line listing of search matches for a query. */
export function formatBooks(providerName: string, query: string, matches: BookMatch[]): string {
  if (matches.length === 0) return `[${providerName}] No matches for "${query}"`;
  const lines = matches.map((match) => formatBookLine(match));
  return `[${providerName}] ${matches.length} matches for "${query}":\n${lines.join("\n")}`;
}

/** Header line naming the book a record belongs to. */
export function formatBookHeader(book: Book): string {
  const title = oneLine(book.subtitle ? `${book.title}: ${book.subtitle}` : book.title);
  const year = book.year !== undefined ? ` (${book.year})` : "";
  return `[${book.provider}] ${title} - ${formatAuthors(book.authors)}${year}`;
}

/** Field lines of a record, in the order a reader scans them. */
function bookFields(book: Book): string[] {
  const fields: [string, string | undefined][] = [
    ["Series", book.series && oneLine(book.series)],
    ["Publisher", book.publisher && oneLine(book.publisher)],
    ["Published", book.published && oneLine(book.published)],
    ["Pages", book.pages === undefined ? undefined : String(book.pages)],
    ["ISBN-13", book.isbn13],
    ["ISBN-10", book.isbn10],
    ["Languages", book.languages.join(", ") || undefined],
    ["Translators", book.translators?.join(", ") || undefined],
    ["Subjects", book.subjects.slice(0, 12).join(", ") || undefined],
    ["Rating", book.rating ? formatRating(book.rating) : undefined],
    ["Id", book.id],
    ["Formats", book.formats?.map((format) => format.type).join(", ") || undefined],
    ["Cover", book.cover],
  ];
  return fields
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([label, value]) => `${label}: ${value}`);
}

/**
 * Full record rendering: header, fields, blurb, then source and attribution.
 *
 * The source URL travels with the record on every surface. Two catalogs disagreeing about a page
 * count is normal, and the reader needs to know which one they are looking at.
 */
export function formatBook(book: Book): string {
  return [
    formatBookHeader(book),
    "",
    ...bookFields(book),
    book.description ? `\n${book.description}` : null,
    "",
    book.url ? `Source: ${book.url}` : null,
    book.attribution ? book.attribution : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Full-text slice rendering: what was read, the text, and how to read on. */
export function formatText(text: BookText): string {
  const end = text.offset + text.bytes;
  const total = text.totalBytes === undefined ? "" : ` of ${text.totalBytes}`;
  const more =
    text.nextOffset === undefined ? null : `(continues - read on from ${text.nextOffset})`;
  return [
    `[${text.provider}] ${oneLine(text.title)} - ${formatAuthors(text.authors)}`,
    `Bytes ${text.offset}-${end}${total}`,
    "",
    text.text,
    "",
    more,
    text.url ? `Source: ${text.url}` : null,
    text.attribution ? text.attribution : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** One scan of a full-text search: a label line, its passages, and the reader link. */
function formatTextMatch(match: TextMatch): string[] {
  const details = [
    match.year !== undefined ? String(match.year) : undefined,
    match.page !== undefined ? `page ${match.page}` : undefined,
    `id=${match.id}`,
  ].filter(Boolean);
  const title = match.title ? oneLine(match.title) : match.id;
  return [
    `${title} - ${formatAuthors(match.authors)}  (${details.join(", ")})`,
    ...match.snippets.map((snippet) => `  > ${oneLine(snippet)}`),
    `  ${match.url}`,
  ];
}

/** Full-text matches with their passages, each on one line so OCR line breaks can't fake rows. */
export function formatTextSearch(result: TextSearchResult, options?: TextSearchOptions): string {
  const query = oneLine(result.query);
  const book = options?.book?.trim();
  const header = book
    ? `[${result.provider}] "${query}" in ${oneLine(book)}`
    : `[${result.provider}] ${result.total} scans contain "${query}"`;
  const more =
    result.nextPage === undefined
      ? null
      : `(more hits - read on with page ${result.nextPage}${book ? " and the same book" : ""})`;

  if (result.matches.length === 0) {
    if (!book && result.total === 0) return `[${result.provider}] No scan contains "${query}"`;
    const reason = book
      ? `no passage up to page ${result.page} of ${result.total} hits; a rarer phrase from the same book ranks it higher`
      : `none on page ${result.page}`;
    return [`${header}: ${reason}`, more].filter((line) => line !== null).join("\n");
  }

  return [
    `${header} (page ${result.page}):`,
    ...result.matches.flatMap((match) => formatTextMatch(match)),
    more,
    result.attribution ?? null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Side-by-side search results from every registered provider, failures included. */
export function formatSearchAll(query: string, outcomes: ProviderOutcome<BookMatch[]>[]): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatBooks(outcome.provider, query, outcome.result),
    )
    .join("\n\n");
}

/** Side-by-side records from every registered provider, failures included. */
export function formatBookAll(outcomes: ProviderOutcome<Book>[]): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatBook(outcome.result),
    )
    .join("\n\n");
}

/** A fallback walk's result, prefixed with the providers that were passed over. */
export function formatFallback<T>(result: FallbackResult<T>, render: (value: T) => string): string {
  const skipped = result.skipped.map((entry) => `[${entry.provider}] skipped: ${entry.error}`);
  return [...skipped, skipped.length > 0 ? "" : null, render(result.result)]
    .filter((line) => line !== null)
    .join("\n");
}

/** Multi-line listing of registered providers and what each can serve. */
export function formatProviders(listings: ProviderListing[]): string {
  const lines = listings.map((listing) => {
    const capabilities = Object.entries(listing.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([operation]) => operation)
      .join(", ");
    const credential = listing.envKey
      ? listing.configured
        ? ` [${listing.envKey} set]`
        : ` [needs ${listing.envKey}]`
      : "";
    const endpoint = listing.defaultUrl ? ` ${listing.defaultUrl}` : "";
    return `  ${listing.name}: ${capabilities || "(nothing)"}${credential}${endpoint}`;
  });
  return `Registered providers (${listings.length}):\n${lines.join("\n")}`;
}
