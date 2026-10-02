/**
 * Open Library provider - the Internet Archive's open catalog of books
 *
 * No API key. The catalog separates a *work* (the book as a text, `OL…W`) from an *edition* (a
 * particular printing, `OL…M`); ISBNs, page counts and publishers belong to editions, while
 * blurbs, subjects and reader scores belong to works. A record here is stitched from both.
 *
 * Full-text search runs over the Internet Archive's scans, lending-only books included, and
 * answers with short passages, not a readable text: `text` stays false.
 *
 * API: https://openlibrary.org/developers/api (REST, JSON)
 */

import type {
  Book,
  BookMatch,
  BookQuery,
  ProviderCapabilities,
  ProviderConfig,
  Rating,
  SearchOptions,
  TextMatch,
  TextSearchOptions,
  TextSearchResult,
} from "../core/types.ts";
import { Provider, assertBookQuery, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { HTTPError, InvalidInputError, NotFoundError, ParseError } from "../core/errors.ts";
import { toIsbn10, toIsbn13 } from "../core/isbn.ts";
import { register } from "../core/registry.ts";
import { normalizeText, parseYear, uniqueStrings } from "../core/text.ts";
import { MAX_SUBJECTS, MAX_TEXT_SEARCH_PAGES, clampMaxResults, toRating } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://openlibrary.org";
const COVERS_BASE_URL = "https://covers.openlibrary.org";

/**
 * How many author records one lookup will fetch.
 *
 * Authors arrive as keys, one request each, and an anthology can list dozens of them. The
 * remaining names are dropped rather than turned into a burst of requests - `Book.authors` then
 * carries the first five, which is what a citation needs.
 */
const MAX_AUTHOR_LOOKUPS = 5;

/** Fields worth asking for; without the parameter every match carries its whole search index. */
const SEARCH_FIELDS = [
  "key",
  "title",
  "author_name",
  "first_publish_year",
  "isbn",
  "language",
  "cover_i",
  "ratings_average",
  "ratings_count",
].join(",");

/** Hits on one full-text page, and the most a caller may ask for. */
const TEXT_SEARCH_RESULTS = 20;
const MAX_TEXT_SEARCH_RESULTS = 100;

/** Default pages for `book`: the endpoint ignores `identifier:`, so hits are filtered here. */
const DEFAULT_TEXT_SEARCH_PAGES = 3;

/** An uncached full-text query took 10 to 16 seconds in the audit, past the shared 15. */
const TEXT_SEARCH_TIMEOUT_MS = 30_000;

/** archive.org identifiers: letters, digits, `.`, `-` and `_`, never starting with a dot. */
const SCAN_ID = /^[\w-][\w.-]*$/;

/** Open Library's rating scale. */
const RATING_SCALE = 5;

/** A blurb is either a string or a typed text node, depending on the record's age. */
type OpenLibraryText = string | Readonly<{ value?: string }>;

/** A reference to another record: `{ "key": "/authors/OL79034A" }`. */
type KeyRef = Readonly<{ key?: string }>;

interface OpenLibrarySearchDocument {
  readonly key?: string;
  readonly title?: string;
  readonly author_name?: readonly string[];
  readonly first_publish_year?: number;
  readonly isbn?: readonly string[];
  readonly language?: readonly string[];
  readonly cover_i?: number;
  readonly ratings_average?: number;
  readonly ratings_count?: number;
}

interface OpenLibrarySearchResponse {
  readonly numFound?: number;
  readonly docs?: readonly OpenLibrarySearchDocument[];
}

/** The metadata of a full-text hit, each field a one-element array. */
interface OpenLibraryInsideFields {
  readonly identifier?: readonly string[];
  readonly meta_title?: readonly string[];
  readonly meta_creator?: readonly string[];
  readonly meta_year?: readonly number[];
  readonly page_num?: readonly (readonly number[])[];
}

/** One hit of `/search/inside.json`; the metadata fields arrive as one-element arrays. */
interface OpenLibraryInsideHit {
  readonly fields?: OpenLibraryInsideFields;
  readonly highlight?: Readonly<{ text?: readonly string[] }>;
}

interface OpenLibraryInsideHits {
  readonly total?: number | Readonly<{ value?: number }>;
  readonly hits?: readonly OpenLibraryInsideHit[];
}

interface OpenLibraryInsideResponse {
  readonly hits?: OpenLibraryInsideHits;
}

interface OpenLibraryEdition {
  readonly key?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly publishers?: readonly string[];
  readonly publish_date?: string;
  readonly number_of_pages?: number;
  readonly isbn_10?: readonly string[];
  readonly isbn_13?: readonly string[];
  readonly languages?: readonly KeyRef[];
  readonly covers?: readonly number[];
  readonly series?: readonly string[];
  readonly subjects?: readonly string[];
  readonly description?: OpenLibraryText;
  readonly works?: readonly KeyRef[];
  readonly authors?: readonly KeyRef[];
}

interface OpenLibraryWork {
  readonly key?: string;
  readonly title?: string;
  readonly subjects?: readonly string[];
  readonly description?: OpenLibraryText;
  readonly covers?: readonly number[];
  readonly first_publish_date?: string;
  readonly authors?: readonly Readonly<{ author?: KeyRef }>[];
}

interface OpenLibraryRatings {
  readonly summary?: Readonly<{ average?: number | null; count?: number | null }>;
}

interface OpenLibraryAuthor {
  readonly name?: string;
  readonly personal_name?: string;
}

/** Open Library record keys, as they appear in a response: `/works/OL893414W`, `/authors/OL79034A`. */
const RECORD_KEY = /^\/?(works|books|authors)\/(OL\d+[AMW])$/;

/**
 * Turn a key from a response into a request path, refusing anything else.
 *
 * A record's `works[0].key` is data the catalog supplies, and it lands between two slashes of
 * the next request. WHATWG resolves `..` inside a path, so a key of `/works/../../admin` would
 * send this library's request to a different resource on the same host - answered, parsed, and
 * returned as if it were a book. Types cannot see that; a shape check can.
 *
 * @param {string | undefined} key A record key from a response.
 * @param {string} provider Provider named in the error.
 * @returns {string} The path, such as `works/OL893414W`.
 * @throws {ParseError} When the key does not have the documented shape.
 */
function recordPath(key: string | undefined, provider: string): string {
  const match = key?.match(RECORD_KEY);
  if (!match) {
    throw new ParseError(`record key is not an Open Library key: ${key}`, provider);
  }
  return `${match[1]}/${match[2]}`;
}

/**
 * Author keys an edition names directly.
 *
 * @param {OpenLibraryEdition | undefined} edition The edition record.
 * @returns {string[]} The author keys.
 */
function editionAuthorKeys(edition: OpenLibraryEdition | undefined): string[] {
  return (edition?.authors ?? []).map((author) => author.key).filter((key) => key !== undefined);
}

/**
 * Author keys a work names, one nesting level deeper than an edition's.
 *
 * @param {OpenLibraryWork | undefined} work The work record.
 * @returns {string[]} The author keys.
 */
function workAuthorKeys(work: OpenLibraryWork | undefined): string[] {
  return (work?.authors ?? []).map((entry) => entry.author?.key).filter((key) => key !== undefined);
}

/**
 * Unwrap a description that may be a bare string or a `/type/text` node.
 *
 * @param {OpenLibraryText | undefined} value The description.
 * @returns {string | undefined} The normalized text.
 */
function readText(value: OpenLibraryText | undefined): string | undefined {
  const text = typeof value === "string" ? value : value?.value;
  return text ? normalizeText(text) : undefined;
}

/**
 * `/works/OL893414W` and `OL893414W` both name the same record.
 *
 * @param {string | undefined} key A record key or a bare id.
 * @returns {string | undefined} The bare id.
 */
function keyId(key: string | undefined): string | undefined {
  return key?.split("/").filter(Boolean).pop();
}

/**
 * `/languages/eng` carries the code in its last segment.
 *
 * @param {readonly KeyRef[] | undefined} languages Language references.
 * @returns {string[]} The language codes.
 */
function languageCodes(languages: readonly KeyRef[] | undefined): string[] {
  return uniqueStrings((languages ?? []).map((language) => keyId(language.key)));
}

/**
 * First ISBN of a search match that passes its check digit, preferred in 13-digit form.
 *
 * @param {readonly string[] | undefined} isbns ISBNs the search index lists.
 * @returns {string | undefined} The first valid one, as ISBN-13.
 */
function pickIsbn(isbns: readonly string[] | undefined): string | undefined {
  for (const isbn of isbns ?? []) {
    const isbn13 = toIsbn13(isbn);
    if (isbn13) return isbn13;
  }
  return undefined;
}

/**
 * Title, authors, year and page of a scan, unwrapped from their one-element arrays.
 *
 * @param {OpenLibraryInsideFields} fields The hit's metadata.
 * @returns {Pick<TextMatch, "title" | "authors" | "year" | "page">} The scan's details.
 */
function scanDetails(
  fields: OpenLibraryInsideFields,
): Pick<TextMatch, "title" | "authors" | "year" | "page"> {
  const title = fields.meta_title?.[0];
  return {
    title: title ? normalizeText(title) : undefined,
    authors: uniqueStrings(fields.meta_creator ?? []),
    year: fields.meta_year?.[0],
    page: fields.page_num?.[0]?.[0],
  };
}

/**
 * The scan a full-text hit belongs to.
 *
 * @param {OpenLibraryInsideHit} hit One hit.
 * @param {string} query The phrase, for the reader link.
 * @returns {TextMatch | undefined} The match, or `undefined` for a hit without a usable identifier.
 */
function toTextMatch(hit: OpenLibraryInsideHit, query: string): TextMatch | undefined {
  const fields = hit.fields ?? {};
  const id = fields.identifier?.[0];
  if (!id || !SCAN_ID.test(id)) return undefined;
  const { title, authors, year, page } = scanDetails(fields);
  return {
    id,
    title,
    authors,
    year,
    page,
    snippets: (hit.highlight?.text ?? []).map((snippet) => snippet.trim()).filter(Boolean),
    url: `https://archive.org/details/${id}${buildQuery({ q: `"${query}"` })}`,
  };
}

/**
 * `hits.total` is a number here, and an object in newer Elasticsearch responses.
 *
 * @param {OpenLibraryInsideHits} hits The response's `hits`.
 * @returns {number} The number of hits, 0 when it's missing.
 */
function hitTotal(hits: OpenLibraryInsideHits): number {
  const total = hits.total;
  return (typeof total === "number" ? total : total?.value) ?? 0;
}

/**
 * A caller's number, or `fallback` when it is missing, `NaN` or infinite.
 *
 * @param {number | undefined} value The number the caller passed.
 * @param {number} fallback The default.
 * @returns {number} The number, or the default.
 */
function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * The scan id a text search is narrowed to.
 *
 * @param {TextSearchOptions} [options] The caller's options.
 * @returns {string | undefined} The trimmed id, or `undefined` when the search isn't narrowed.
 * @throws {InvalidInputError} When the id isn't an archive.org identifier.
 */
function scanFilter(options?: TextSearchOptions): string | undefined {
  const book = options?.book?.trim() || undefined;
  if (book && !SCAN_ID.test(book)) {
    throw new InvalidInputError(
      "book must be the id of a text search match: letters, digits, '.', '-' and '_'",
      OpenLibrary.key,
    );
  }
  return book;
}

/** Which pages of hits a text search reads, and how many hits each holds. */
interface HitWindow {
  readonly first: number;
  readonly pages: number;
  readonly limit: number;
}

/**
 * The pages a text search reads: one for an open search, up to `maxPages` when looking for a scan.
 *
 * @param {string | undefined} book The scan the search is narrowed to.
 * @param {TextSearchOptions} [options] The caller's options.
 * @returns {HitWindow} The first page, the page count and the hits per page.
 */
function hitWindow(book: string | undefined, options?: TextSearchOptions): HitWindow {
  const limit = clampMaxResults(
    finiteOr(options?.limit, book ? MAX_TEXT_SEARCH_RESULTS : TEXT_SEARCH_RESULTS),
    MAX_TEXT_SEARCH_RESULTS,
  );
  const pages = book
    ? clampMaxResults(finiteOr(options?.maxPages, DEFAULT_TEXT_SEARCH_PAGES), MAX_TEXT_SEARCH_PAGES)
    : 1;
  return { first: Math.max(1, Math.round(finiteOr(options?.page, 1))), pages, limit };
}

/** The records a lookup found, and what is still to fetch for them. */
interface Lookup {
  readonly workKey?: string;
  readonly authorKeys: readonly string[];
}

/**
 * The work key and the author keys known before the second wave of requests.
 *
 * @param {OpenLibraryEdition | undefined} edition The edition, when the query named one.
 * @param {OpenLibraryWork | undefined} work The work, when `locate` fetched it.
 * @returns {Lookup} The work to fetch and the authors to resolve.
 */
function lookupOf(edition?: OpenLibraryEdition, work?: OpenLibraryWork): Lookup {
  const editionAuthors = editionAuthorKeys(edition);
  return {
    workKey: work?.key ?? edition?.works?.[0]?.key,
    authorKeys: editionAuthors.length > 0 ? editionAuthors : workAuthorKeys(work),
  };
}

/**
 * Both ISBNs of an edition; the 13-digit one falls back to converting the ten.
 *
 * @param {OpenLibraryEdition} edition The edition record.
 * @returns {Pick<Book, "isbn10" | "isbn13">} The ISBNs.
 */
function isbnsOf(edition: OpenLibraryEdition): Pick<Book, "isbn10" | "isbn13"> {
  return {
    isbn10: toIsbn10(edition.isbn_10?.[0]),
    isbn13: toIsbn13(edition.isbn_13?.[0] ?? edition.isbn_10?.[0]),
  };
}

/** The fields only an edition carries. */
type Imprint = Pick<
  Book,
  "subtitle" | "published" | "publisher" | "pages" | "languages" | "series"
>;

/**
 * What only the edition knows: the printing's subtitle, date, publisher, length and languages.
 *
 * @param {OpenLibraryEdition} edition The edition record.
 * @returns {Imprint} The edition's own fields.
 */
function imprintOf(edition: OpenLibraryEdition): Imprint {
  return {
    subtitle: edition.subtitle,
    published: edition.publish_date,
    publisher: edition.publishers?.[0],
    pages: edition.number_of_pages,
    languages: languageCodes(edition.languages),
    series: edition.series?.[0],
  };
}

/**
 * Subjects and blurb, the work's first and the edition's after.
 *
 * @param {OpenLibraryEdition} edition The edition record.
 * @param {OpenLibraryWork} work The work record.
 * @returns {Pick<Book, "subjects" | "description">} The edition's own fields.
 */
function aboutOf(
  edition: OpenLibraryEdition,
  work: OpenLibraryWork,
): Pick<Book, "subjects" | "description"> {
  return {
    subjects: uniqueStrings([...(work.subjects ?? []), ...(edition.subjects ?? [])]).slice(
      0,
      MAX_SUBJECTS,
    ),
    description: readText(work.description ?? edition.description),
  };
}

/**
 * The large cover image, the edition's before the work's.
 *
 * @param {OpenLibraryEdition} edition The edition record.
 * @param {OpenLibraryWork} work The work record.
 * @returns {string | undefined} The image URL.
 */
function coverOf(edition: OpenLibraryEdition, work: OpenLibraryWork): string | undefined {
  const cover = edition.covers?.[0] ?? work.covers?.[0];
  return cover === undefined ? undefined : `${COVERS_BASE_URL}/b/id/${cover}-L.jpg`;
}

/** Everything a record is stitched from. */
interface Sources {
  readonly edition: OpenLibraryEdition;
  readonly work: OpenLibraryWork;
  readonly rating?: Readonly<Rating>;
  readonly authors: readonly string[];
}

/**
 * Stitch a record from an edition and its work, the edition winning where both have a field.
 *
 * @param {Sources} sources The records and what was resolved for them.
 * @param {string} baseUrl Site root for the record link.
 * @returns {Book} The record.
 */
function toBook(sources: Sources, baseUrl: string): Book {
  const { edition, work } = sources;
  const imprint = imprintOf(edition);
  const isbns = isbnsOf(edition);
  const about = aboutOf(edition, work);
  const canonicalKey = edition.key ?? work.key;
  return {
    provider: OpenLibrary.key,
    title: edition.title ?? work.title ?? "",
    subtitle: imprint.subtitle,
    authors: [...sources.authors],
    year: parseYear(edition.publish_date ?? work.first_publish_date),
    published: imprint.published,
    publisher: imprint.publisher,
    isbn10: isbns.isbn10,
    isbn13: isbns.isbn13,
    pages: imprint.pages,
    languages: imprint.languages,
    subjects: about.subjects,
    series: imprint.series,
    description: about.description,
    cover: coverOf(edition, work),
    rating: sources.rating,
    id: keyId(canonicalKey),
    url: canonicalKey ? `${baseUrl}${canonicalKey}` : undefined,
    attribution: "Catalog data from Open Library (openlibrary.org)",
  };
}

class OpenLibrary extends Provider {
  static readonly key = "openlibrary";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      book: true,
      text: false,
      searchText: true,
      isbn: true,
      ratings: true,
    };
  }

  override async search(query: string, options?: SearchOptions): Promise<BookMatch[]> {
    assertQuery(query, OpenLibrary.key);
    const url = `${this.baseUrl}/search.json${buildQuery({
      q: query,
      limit: clampMaxResults(options?.limit, MAX_RESULTS),
      fields: SEARCH_FIELDS,
    })}`;
    const data = await this.getJSON<OpenLibrarySearchResponse>(url);
    return (data.docs ?? []).map((doc) => ({
      title: doc.title ?? "",
      authors: uniqueStrings(doc.author_name ?? []),
      year: doc.first_publish_year,
      id: keyId(doc.key),
      isbn: pickIsbn(doc.isbn),
      language: doc.language?.[0],
      url: doc.key ? `${this.baseUrl}${doc.key}` : undefined,
      rating: toRating(doc.ratings_average, RATING_SCALE, doc.ratings_count),
    }));
  }

  /**
   * Find a phrase; with `book`, read pages until that scan shows up or `maxPages` run out.
   *
   * @param {string} query The phrase.
   * @param {TextSearchOptions} [options] Page, hits per page, and the scan to look for.
   * @returns {Promise<TextSearchResult>} The matches on the last page read.
   */
  override async searchText(query: string, options?: TextSearchOptions): Promise<TextSearchResult> {
    assertQuery(query, OpenLibrary.key);
    const phrase = query.trim();
    const book = scanFilter(options);
    const { first, pages, limit } = hitWindow(book, options);

    let page = first;
    let total = 0;
    let matches: TextMatch[] = [];
    for (; page < first + pages; page += 1) {
      ({ total, matches } = await this.hitPage(phrase, page, limit, book));
      if (matches.length > 0 || !book || page * limit >= total) break;
    }

    const last = Math.min(page, first + pages - 1);
    return {
      provider: OpenLibrary.key,
      query: phrase,
      total,
      page: last,
      matches,
      nextPage: last * limit < total ? last + 1 : undefined,
      attribution: "Passages from Internet Archive scans, found through Open Library",
    };
  }

  /**
   * One page of full-text hits, narrowed to one scan when `book` names it.
   *
   * @param {string} phrase The phrase.
   * @param {number} page Page of hits, from 1.
   * @param {number} limit Hits per page.
   * @param {string | undefined} book The scan to keep, or `undefined` to keep every hit.
   * @returns {Promise<{ total: number; matches: TextMatch[] }>} The hit count and the matches kept.
   * @throws {ParseError} When the response carries no `hits`.
   */
  private async hitPage(
    phrase: string,
    page: number,
    limit: number,
    book: string | undefined,
  ): Promise<{ total: number; matches: TextMatch[] }> {
    const url = `${this.baseUrl}/search/inside.json${buildQuery({ q: phrase, page, limit })}`;
    const data = await this.getJSON<OpenLibraryInsideResponse>(url, TEXT_SEARCH_TIMEOUT_MS);
    if (!data.hits) {
      throw new ParseError("full-text search answered without hits", OpenLibrary.key);
    }
    const found = (data.hits.hits ?? [])
      .map((hit) => toTextMatch(hit, phrase))
      .filter((match) => match !== undefined);
    return {
      total: hitTotal(data.hits),
      matches: book ? found.filter((match) => match.id === book) : found,
    };
  }

  /**
   * Fetch one record, stitched from an edition and its work.
   *
   * Author keys are known up front whenever the edition lists them, or whenever `locate` already
   * fetched the work. Resolving those in the same wave as the work and its ratings is what keeps
   * a title lookup at three round trips instead of four; only an edition that names no authors
   * of its own needs the extra one.
   *
   * @param {BookQuery} query The book to look up.
   * @returns {Promise<Book>} The record.
   */
  async book(query: BookQuery): Promise<Book> {
    const checked = assertBookQuery(query, OpenLibrary.key);
    const { edition, work: found } = await this.locate(checked);
    const { workKey, authorKeys } = lookupOf(edition, found);

    const [work, rating, knownAuthors] = await Promise.all([
      found ?? (workKey ? this.fetchOptionalWork(workKey, edition !== undefined) : undefined),
      workKey ? this.fetchRatings(workKey) : undefined,
      authorKeys.length > 0 ? this.fetchAuthors(authorKeys) : undefined,
    ]);
    const authors = knownAuthors ?? (await this.fetchAuthors(workAuthorKeys(work)));

    return toBook({ edition: edition ?? {}, work: work ?? {}, rating, authors }, this.baseUrl);
  }

  /**
   * Find the edition or work a query names, in one request where the catalog allows one.
   *
   * `/isbn/{isbn}` answers a redirect to the edition record, which `fetch` follows.
   *
   * @param {BookQuery} query A checked book query.
   * @returns {Promise<{ edition?: OpenLibraryEdition; work?: OpenLibraryWork }>} The record found.
   * @throws {NotFoundError} When a title search finds nothing.
   */
  private async locate(
    query: BookQuery,
  ): Promise<{ edition?: OpenLibraryEdition; work?: OpenLibraryWork }> {
    if (query.isbn) {
      return {
        edition: await this.getJSON<OpenLibraryEdition>(`${this.baseUrl}/isbn/${query.isbn}.json`),
      };
    }
    if (query.id) return this.locateId(query.id);

    const url = `${this.baseUrl}/search.json${buildQuery({
      title: query.title,
      author: query.author,
      limit: 1,
      fields: SEARCH_FIELDS,
    })}`;
    const found = await this.getJSON<OpenLibrarySearchResponse>(url);
    const key = found.docs?.[0]?.key;
    if (!key) {
      throw new NotFoundError(
        [query.title, query.author].filter(Boolean).join(" / "),
        OpenLibrary.key,
      );
    }
    return { work: await this.fetchWork(key) };
  }

  /**
   * Fetch the edition or work an Open Library id names.
   *
   * @param {string} id An `OL…M` or `OL…W` id, bare or as a key.
   * @returns {Promise<{ edition?: OpenLibraryEdition; work?: OpenLibraryWork }>} The record.
   * @throws {InvalidInputError} When the id is neither.
   */
  private async locateId(
    id: string,
  ): Promise<{ edition?: OpenLibraryEdition; work?: OpenLibraryWork }> {
    const bare = keyId(id)?.toUpperCase() ?? "";
    if (/^OL\d+M$/.test(bare)) {
      return {
        edition: await this.getJSON<OpenLibraryEdition>(`${this.baseUrl}/books/${bare}.json`),
      };
    }
    if (/^OL\d+W$/.test(bare)) {
      return { work: await this.fetchWork(`/works/${bare}`) };
    }
    throw new InvalidInputError(
      `id must be an Open Library work (OL…W) or edition (OL…M) key, got "${id}"`,
      OpenLibrary.key,
    );
  }

  /**
   * The work behind an edition, or `undefined` when only the work is missing.
   *
   * An edition already carries the title, ISBN, publisher and page count; the work adds the
   * blurb and the subjects. When the edition was fetched successfully and its work key 404s -
   * the catalog is edited by the public and does go inconsistent - returning the record without
   * a blurb beats reporting a book that this catalog demonstrably holds as "not found", which
   * is also what a fallback walk would act on.
   *
   * @param {string} key The work key.
   * @param {boolean} optional Whether a missing work leaves the record usable.
   * @returns {Promise<OpenLibraryWork | undefined>} The work; `undefined` when optional and gone.
   */
  private async fetchOptionalWork(
    key: string,
    optional: boolean,
  ): Promise<OpenLibraryWork | undefined> {
    try {
      return await this.fetchWork(key);
    } catch (error) {
      if (optional && (error instanceof NotFoundError || error instanceof ParseError)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Fetch a work record.
   *
   * @param {string} key The work key.
   * @returns {Promise<OpenLibraryWork>} The work.
   */
  private fetchWork(key: string): Promise<OpenLibraryWork> {
    return this.getJSON<OpenLibraryWork>(
      `${this.baseUrl}/${recordPath(key, OpenLibrary.key)}.json`,
    );
  }

  /**
   * Reader scores for a work, or `undefined` when it has none.
   *
   * Scores are an ornament on a bibliographic record: a work nobody has rated answers 404 here,
   * and that must not take the record down with it. A rate limit travels on instead: swallowing
   * that one would report a book as unrated when the catalog is simply refusing requests.
   *
   * @param {string} key The work key.
   * @returns {Promise<Book["rating"]>} The score.
   */
  private async fetchRatings(key: string): Promise<Book["rating"]> {
    try {
      const data = await this.getJSON<OpenLibraryRatings>(
        `${this.baseUrl}/${recordPath(key, OpenLibrary.key)}/ratings.json`,
      );
      return toRating(
        data.summary?.average ?? undefined,
        RATING_SCALE,
        data.summary?.count ?? undefined,
      );
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof HTTPError) return undefined;
      throw error;
    }
  }

  /**
   * Resolve author keys to names, up to `MAX_AUTHOR_LOOKUPS` of them.
   *
   * @param {readonly string[]} keys Author keys.
   * @returns {Promise<string[]>} The distinct names.
   */
  private async fetchAuthors(keys: readonly string[]): Promise<string[]> {
    const records = await Promise.all(
      keys
        .slice(0, MAX_AUTHOR_LOOKUPS)
        .map((key) =>
          this.getJSON<OpenLibraryAuthor>(
            `${this.baseUrl}/${recordPath(key, OpenLibrary.key)}.json`,
          ),
        ),
    );
    return uniqueStrings(records.map((author) => author.name ?? author.personal_name));
  }
}

register(OpenLibrary, DEFAULT_BASE_URL);
