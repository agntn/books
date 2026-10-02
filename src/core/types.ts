/** Books - unified book catalog and full-text provider types */

/** Reader score for a book, kept on the provider's own scale. */
export interface Rating {
  /** Mean score, on `scale` */
  average: number;
  /** Highest score the provider's scale allows - 5 on Open Library, 10 on Lubimyczytać */
  scale: number;
  /** How many readers scored the book, when the provider reports it */
  count?: number;
}

/** A downloadable rendering of a public-domain text. */
export interface BookFormat {
  /** Media type as the provider labels it, for example `text/plain; charset=utf-8` */
  type: string;
  /** Direct URL to the file */
  url: string;
}

/** A book a provider knows about, before its full record is fetched. */
export interface BookMatch {
  /** Title as the provider spells it */
  title: string;
  /** Authors as the provider spells them; empty when the provider lists none */
  authors: string[];
  /** Publication year the provider associates with the book */
  year?: number;
  /** Provider-native identifier; pass it back as `BookQuery.id` for an exact lookup */
  id?: string;
  /** ISBN-13 when the provider carries one for this match */
  isbn?: string;
  /** Language as the provider labels it - the codes are not normalized across providers */
  language?: string;
  /** Canonical page for the book on the provider */
  url?: string;
  /** Reader score when the provider serves one */
  rating?: Rating;
  /** Raw provider data */
  raw?: Record<string, unknown>;
}

/** One book's normalized bibliographic record. */
export interface Book {
  /** Registry key of the provider that served the record */
  provider: string;
  /** Title as the provider spells it */
  title: string;
  /** Subtitle when the provider records one separately */
  subtitle?: string;
  /** Authors as the provider spells them */
  authors: string[];
  /** Translators, for the catalogs that record them */
  translators?: string[];
  /** Publication year, parsed from whatever date shape the provider uses */
  year?: number;
  /** Publication date as printed by the provider, unparsed */
  published?: string;
  /** Publisher of the edition the record describes */
  publisher?: string;
  /** ISBN-10 of the edition, digits and a possible `X` check character */
  isbn10?: string;
  /** ISBN-13 of the edition, digits only */
  isbn13?: string;
  /** Page count of the edition */
  pages?: number;
  /** Languages as the provider labels them */
  languages: string[];
  /** Subject headings, genres, and shelves the provider assigns */
  subjects: string[];
  /** Series the book belongs to, with its position when the provider gives one */
  series?: string;
  /** Blurb, summary, or abstract */
  description?: string;
  /** Cover image URL */
  cover?: string;
  /** Reader score when the provider serves one */
  rating?: Rating;
  /** Downloadable files, for the public-domain libraries */
  formats?: BookFormat[];
  /** Provider-native identifier; pass it back as `BookQuery.id` */
  id?: string;
  /** Canonical page for the book on the provider */
  url?: string;
  /** Attribution or licence line the provider asks callers to show */
  attribution?: string;
}

/**
 * A slice of a book's full text.
 *
 * `offset` and `bytes` count bytes of the source file, not characters: they are the units the
 * providers' HTTP range requests use, and adding them gives the offset of the next slice.
 */
export interface BookText {
  /** Registry key of the provider that served the text */
  provider: string;
  /** Title as the provider spells it */
  title: string;
  /** Authors as the provider spells them */
  authors: string[];
  /** The text itself, decoded as UTF-8 */
  text: string;
  /** Byte offset this slice starts at */
  offset: number;
  /** How many bytes of the source file this slice covers */
  bytes: number;
  /** Size of the whole file in bytes, when the server reports it */
  totalBytes?: number;
  /** True when the file continues past this slice */
  truncated: boolean;
  /** Byte offset to pass as `offset` for the next slice; absent once the end is reached */
  nextOffset?: number;
  /** File the text came from */
  url?: string;
  /** Attribution or licence line the provider asks callers to show */
  attribution?: string;
}

/**
 * Identifies the book a lookup is about.
 *
 * The fields are alternatives, not a conjunction: an `isbn` alone, an `id` from a previous
 * search on the same provider, or a `title` (sharpened by `author`) each identify a book. ISBN
 * lookups only reach providers whose `isbn` capability is true.
 */
export interface BookQuery {
  /** ISBN-10 or ISBN-13; separators are ignored and the check digit is verified */
  isbn?: string;
  /** Title, for providers that match on it */
  title?: string;
  /** Author, used to sharpen a title match */
  author?: string;
  /** Provider-native identifier from a previous `search()` result */
  id?: string;
}

/** Options for `search()`. */
export interface SearchOptions {
  /** Max results; providers clamp to their own maximum */
  limit?: number;
}

/** Options for `text()`. */
export interface TextOptions {
  /** Byte offset to start reading at; defaults to the start of the file */
  offset?: number;
  /** Max bytes to read in one call; providers clamp it to `MAX_TEXT_BYTES` */
  maxBytes?: number;
}

/** A scanned book holding passages that match a full-text search. */
export interface TextMatch {
  /** Identifier of the scan; pass it back as `TextSearchOptions.book` to search that book alone */
  id: string;
  /** Title as the scan's metadata spells it */
  title?: string;
  /** Authors as the scan's metadata spells them; empty when it lists none */
  authors: string[];
  /** Publication year from the scan's metadata */
  year?: number;
  /** Page of the scan the passages sit on, as the search index numbers it */
  page?: number;
  /** Short passages around the match, the matched words wrapped in `{{{` and `}}}` */
  snippets: string[];
  /** The scan in its reader, opened on this search */
  url: string;
}

/** One page of a full-text search across scanned books. */
export interface TextSearchResult {
  /** Registry key of the provider that ran the search */
  provider: string;
  /** The query as it was sent */
  query: string;
  /** Matching scans across the whole corpus, not only on the pages read */
  total: number;
  /** Last page that was read */
  page: number;
  /** Matching scans, best match first; only the requested book when `book` was given */
  matches: TextMatch[];
  /** Page to pass as `page`, with the same `limit` and `book`, to read on; absent at the end */
  nextPage?: number;
  /** Attribution line the provider asks callers to show */
  attribution?: string;
}

/** Options for `searchText()`. */
export interface TextSearchOptions {
  /** Page of hits to start at, from 1 */
  page?: number;
  /** Max matches on a page; providers clamp to their own maximum */
  limit?: number;
  /** Scan identifier from a previous match; only that book's passages are returned */
  book?: string;
  /** Pages to read while looking for `book`; clamped to `MAX_TEXT_SEARCH_PAGES` */
  maxPages?: number;
}

/** Feature flags for what a provider can actually serve at runtime. */
export interface ProviderCapabilities {
  /** Can list books matching a free-form query */
  search: boolean;
  /** Can return a bibliographic record for one book */
  book: boolean;
  /** Can return the full text of a public-domain book */
  text: boolean;
  /** Can find a phrase inside scans; optional, so a provider registered elsewhere compiles */
  searchText?: boolean;
  /** Can find a book from an ISBN */
  isbn: boolean;
  /** Carries reader scores on its records */
  ratings: boolean;
}

/** Shared construction options. Providers ignore fields they cannot use. */
export interface ProviderConfig {
  /**
   * API key or access token.
   *
   * No built-in provider needs one - every backend here is a public catalog - but the field is
   * part of the construction contract so an externally registered keyed provider takes part on
   * the same terms.
   */
  apiKey?: string;
  /** Custom API base URL when the provider supports an override. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeout?: number;
}

/**
 * Subject headings kept on a record.
 *
 * Open Library alone can attach hundreds - every shelf, award and reading-list tag a contributor
 * ever added. Past the first couple of dozen they describe the catalog's folksonomy rather than
 * the book.
 */
export const MAX_SUBJECTS = 25;

/** Bytes returned by `text()` when the caller names no bound. */
export const DEFAULT_TEXT_BYTES = 32_768;

/** Hard ceiling on one `text()` slice: a whole novel does not belong in one tool result. */
export const MAX_TEXT_BYTES = 262_144;

/** Pages one `searchText()` call reads for a book; one can take ten seconds on Open Library. */
export const MAX_TEXT_SEARCH_PAGES = 10;

/**
 * Round a requested result limit and keep it inside the provider's range.
 *
 * A missing or zero limit uses `max`.
 */
export function clampMaxResults(limit?: number, max = 10): number {
  if (!limit) return max;
  return Math.min(Math.max(1, Math.round(limit)), max);
}

/**
 * A score, or `undefined` when nobody has rated the book.
 *
 * Catalogs print an unrated book as `0`, which is not a score on any of their scales: rendering
 * it as `0/10` reads as a book readers hated rather than one nobody has opened. Both providers
 * that carry ratings go through here, so they cannot disagree about it.
 */
export function toRating(
  average: number | undefined,
  scale: number,
  count?: number,
): Rating | undefined {
  if (average === undefined || average <= 0) return undefined;
  return { average, scale, count };
}

/**
 * Round a requested byte count into `[1, MAX_TEXT_BYTES]`.
 *
 * Lives here rather than in each provider because the ceiling protects the caller's context
 * window, which has nothing to do with which library serves the file.
 */
export function clampTextBytes(maxBytes?: number): number {
  if (!maxBytes) return DEFAULT_TEXT_BYTES;
  return Math.min(Math.max(1, Math.round(maxBytes)), MAX_TEXT_BYTES);
}
