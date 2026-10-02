/** Plain-text formatters shared by the CLI, MCP server, AI tools, and agent extensions. */

import type { FallbackResult, ProviderOutcome } from "./all.ts";
import type { ProviderListing } from "./registry.ts";
import type {
  Book,
  BookMatch,
  BookText,
  Rating,
  TextFollowResult,
  TextMatch,
  TextSearchOptions,
  TextSearchResult,
} from "./types.ts";

/**
 * Reader score with its scale, because 8.2 means different things out of 5 and out of 10.
 *
 * @param {Readonly<Rating>} rating The score.
 * @returns {string} Such as `4.02/5 from 1200 ratings`.
 */
export function formatRating(rating: Readonly<Rating>): string {
  const count = rating.count === undefined ? "" : ` from ${rating.count} ratings`;
  return `${rating.average.toFixed(2).replace(/\.?0+$/, "")}/${rating.scale}${count}`;
}

/**
 * Flatten a field that is rendered on one line.
 *
 * Catalog data is somebody else's text: a title carrying a newline would print as a second row
 * that reads exactly like a real record, in a list where every row is a book.
 *
 * @param {string} value Catalog text.
 * @returns {string} The text on one line.
 */
function oneLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/**
 * Comma-separated authors, or a placeholder when the provider listed none.
 *
 * @param {readonly string[]} authors Author names.
 * @returns {string} The names on one line.
 */
function formatAuthors(authors: readonly string[]): string {
  return authors.length > 0
    ? authors.map((author) => oneLine(author)).join(", ")
    : "unknown author";
}

/**
 * One-line label for a book in a list of matches.
 *
 * @param {BookMatch} match The match.
 * @returns {string} Title, authors and the details a reader picks a match by.
 */
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

/**
 * Multi-line listing of search matches for a query.
 *
 * @param {string} providerName Provider that answered.
 * @param {string} query The search query.
 * @param {readonly BookMatch[]} matches The matches.
 * @returns {string} A header line and one line per match.
 */
export function formatBooks(
  providerName: string,
  query: string,
  matches: readonly BookMatch[],
): string {
  if (matches.length === 0) return `[${providerName}] No matches for "${query}"`;
  const lines = matches.map((match) => formatBookLine(match));
  return `[${providerName}] ${matches.length} matches for "${query}":\n${lines.join("\n")}`;
}

/**
 * Header line naming the book a record belongs to.
 *
 * @param {Book} book The record.
 * @returns {string} Provider, title, authors and year.
 */
export function formatBookHeader(book: Book): string {
  const title = oneLine(book.subtitle ? `${book.title}: ${book.subtitle}` : book.title);
  const year = book.year !== undefined ? ` (${book.year})` : "";
  return `[${book.provider}] ${title} - ${formatAuthors(book.authors)}${year}`;
}

/** A labelled field of a record, absent when the catalog does not have it. */
type Field = readonly [label: string, value: string | undefined];

/**
 * The edition: who published it, when, and under which numbers.
 *
 * @param {Book} book The record.
 * @returns {Field[]} Series, publisher, date, pages and both ISBNs.
 */
function editionFields(book: Book): Field[] {
  return [
    ["Series", book.series && oneLine(book.series)],
    ["Publisher", book.publisher && oneLine(book.publisher)],
    ["Published", book.published && oneLine(book.published)],
    ["Pages", book.pages === undefined ? undefined : String(book.pages)],
    ["ISBN-13", book.isbn13],
    ["ISBN-10", book.isbn10],
  ];
}

/**
 * The work and the catalog entry: languages, subjects, rating and where to get it.
 *
 * @param {Book} book The record.
 * @returns {Field[]} The remaining fields, in reading order.
 */
function workFields(book: Book): Field[] {
  return [
    ["Languages", book.languages.join(", ") || undefined],
    ["Translators", book.translators?.join(", ") || undefined],
    ["Subjects", book.subjects.slice(0, 12).join(", ") || undefined],
    ["Rating", book.rating ? formatRating(book.rating) : undefined],
    ["Id", book.id],
    ["Formats", book.formats?.map((format) => format.type).join(", ") || undefined],
    ["Cover", book.cover],
  ];
}

/**
 * Field lines of a record, in the order a reader scans them.
 *
 * @param {Book} book The record.
 * @returns {string[]} One `Label: value` line per field the record has.
 */
function bookFields(book: Book): string[] {
  return [...editionFields(book), ...workFields(book)]
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([label, value]) => `${label}: ${value}`);
}

/**
 * Full record rendering: header, fields, blurb, then source and attribution.
 *
 * The source URL travels with the record on every surface. Two catalogs disagreeing about a page
 * count is normal, and the reader needs to know which one they are looking at.
 *
 * @param {Book} book The record.
 * @returns {string} The record as text.
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

/**
 * Full-text slice rendering: what was read, the text, and how to read on.
 *
 * @param {BookText} text The slice.
 * @returns {string} The slice with its byte range and the offset to read on from.
 */
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

/**
 * One scan of a full-text search: a label line, its passages, and the reader link.
 *
 * @param {TextMatch} match The scan.
 * @returns {string[]} The lines for that scan.
 */
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

/**
 * The line that says how to read the next page of hits.
 *
 * @param {TextSearchResult} result The search result.
 * @param {string | undefined} book The scan the search was narrowed to.
 * @returns {string | null} The line, or `null` on the last page.
 */
function moreHits(result: TextSearchResult, book: string | undefined): string | null {
  if (result.nextPage === undefined) return null;
  return `(more hits - read on with page ${result.nextPage}${book ? " and the same book" : ""})`;
}

/**
 * Why a page of a full-text search came back empty.
 *
 * @param {TextSearchResult} result The search result.
 * @param {string | undefined} book The scan the search was narrowed to.
 * @returns {string} The reason, worded for a narrowed or an open search.
 */
function emptyReason(result: TextSearchResult, book: string | undefined): string {
  return book
    ? `no passage up to page ${result.page} of ${result.total} hits; a rarer phrase from the same book ranks it higher`
    : `none on page ${result.page}`;
}

/**
 * Full-text matches with their passages, each on one line so OCR line breaks can't fake rows.
 *
 * @param {TextSearchResult} result The search result.
 * @param {TextSearchOptions} [options] The options the search ran with.
 * @returns {string} The matches as text.
 */
export function formatTextSearch(result: TextSearchResult, options?: TextSearchOptions): string {
  const query = oneLine(result.query);
  const book = options?.book?.trim();
  const header = book
    ? `[${result.provider}] "${query}" in ${oneLine(book)}`
    : `[${result.provider}] ${result.total} scans contain "${query}"`;
  const more = moreHits(result, book);

  if (result.matches.length === 0) {
    if (!book && result.total === 0) return `[${result.provider}] No scan contains "${query}"`;
    return [`${header}: ${emptyReason(result, book)}`, more]
      .filter((line) => line !== null)
      .join("\n");
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

/**
 * The last line of a chained read: why it stopped and the query that reads on.
 *
 * @param {TextFollowResult} result The chained read.
 * @returns {string} The line.
 */
function followStop(result: TextFollowResult): string {
  const anchor = `"${oneLine(result.anchor)}"`;
  const away = result.direction === "forward" ? "further on" : "further back";
  switch (result.stop) {
    case "steps":
      return `(read on: query ${anchor}, the same book and direction)`;
    case "lost":
      return `(lost the book: ${anchor} did not find it in the hits read; restart from a phrase of the main text ${away}, or raise maxPages)`;
    case "end":
      return `(no words past ${anchor} in the scan's passage; restart from a phrase ${away})`;
    case "repeat":
      return `(the passage repeats at ${anchor}; restart from a phrase ${away})`;
    case "error":
      return `(stopped by a failed search: ${oneLine(result.error ?? "unknown error")}; read on: query ${anchor}, the same book and direction)`;
  }
}

/**
 * A passage read by chaining searches, on one line, with the query that reads on.
 *
 * @param {TextFollowResult} result The chained read.
 * @returns {string} The read as text.
 */
export function formatTextFollow(result: TextFollowResult): string {
  const title = result.title ? oneLine(result.title) : result.book;
  return [
    `[${result.provider}] ${title} - ${formatAuthors(result.authors)}  (id=${result.book}, ${result.direction} from "${oneLine(result.query)}", ${result.searches} ${result.searches === 1 ? "search" : "searches"})`,
    oneLine(result.passage),
    followStop(result),
    result.url,
    result.attribution ?? null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Side-by-side search results from every registered provider, failures included.
 *
 * @param {string} query The search query.
 * @param {readonly ProviderOutcome<BookMatch[]>[]} outcomes Each provider's matches or failure.
 * @returns {string} One block per provider.
 */
export function formatSearchAll(
  query: string,
  outcomes: readonly ProviderOutcome<BookMatch[]>[],
): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatBooks(outcome.provider, query, outcome.result),
    )
    .join("\n\n");
}

/**
 * Side-by-side records from every registered provider, failures included.
 *
 * @param {readonly ProviderOutcome<Book>[]} outcomes Each provider's record or failure.
 * @returns {string} One block per provider.
 */
export function formatBookAll(outcomes: readonly ProviderOutcome<Book>[]): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatBook(outcome.result),
    )
    .join("\n\n");
}

/**
 * A fallback walk's result, prefixed with the providers that were passed over.
 *
 * @param {FallbackResult<T>} result The walk's result.
 * @param {(value: T) => string} render Formatter for the result itself.
 * @returns {string} The skipped providers, then the rendered result.
 */
export function formatFallback<T>(result: FallbackResult<T>, render: (value: T) => string): string {
  const skipped = result.skipped.map((entry) => `[${entry.provider}] skipped: ${entry.error}`);
  return [...skipped, skipped.length > 0 ? "" : null, render(result.result)]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Multi-line listing of registered providers and what each can serve.
 *
 * @param {readonly ProviderListing[]} listings Rows from `listProviders()`.
 * @returns {string} A header line and one line per provider.
 */
export function formatProviders(listings: readonly ProviderListing[]): string {
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
