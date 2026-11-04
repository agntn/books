/**
 * Gutendex provider - Project Gutenberg's catalog, with the texts themselves
 *
 * No API key. Everything here is out of copyright in the United States, which is why this is one
 * of the two providers that can hand back a whole book rather than a description of one. The
 * catalog has no publication dates and no ISBNs - a Gutenberg entry describes a text, not a
 * printed edition.
 *
 * API: https://gutendex.com (REST, JSON), texts served from gutenberg.org. Paths keep the slash
 * after `/books/`, since `/books?search=` costs a 301 to the same place.
 */

import type {
  Book,
  BookFormat,
  BookMatch,
  BookQuery,
  BookText,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
  TextOptions,
} from "../core/types.ts";
import { Provider, assertBookQuery, assertQuery, searchTerms } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { InvalidInputError, NotFoundError, UnsupportedOperationError } from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { normalizeText, uniqueStrings } from "../core/text.ts";
import { MAX_SUBJECTS, clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 32;
const DEFAULT_BASE_URL = "https://gutendex.com";

/** Gutenberg book ids are the numbers in `gutenberg.org/ebooks/84`. */
const BOOK_ID = /^\d+$/;

interface GutendexAuthor {
  readonly name?: string;
  readonly birth_year?: number | null;
  readonly death_year?: number | null;
}

interface GutendexBook {
  readonly id?: number;
  readonly title?: string;
  readonly authors?: readonly GutendexAuthor[];
  readonly translators?: readonly GutendexAuthor[];
  readonly summaries?: readonly string[];
  readonly subjects?: readonly string[];
  readonly bookshelves?: readonly string[];
  readonly languages?: readonly string[];
  readonly copyright?: boolean | null;
  readonly media_type?: string;
  readonly formats?: Readonly<Record<string, string>>;
  readonly download_count?: number;
}

interface GutendexResponse {
  readonly count?: number;
  readonly results?: readonly GutendexBook[];
}

/**
 * Page for a book on gutenberg.org, which is where a citation should point.
 *
 * @param {number | undefined} id Gutenberg book number.
 * @returns {string | undefined} The page URL, or `undefined` without an id.
 */
function bookUrl(id: number | undefined): string | undefined {
  return id === undefined ? undefined : `https://www.gutenberg.org/ebooks/${id}`;
}

/**
 * The UTF-8 plain-text rendering, when the book has one.
 *
 * The key carries its charset (`text/plain; charset=utf-8`), and older entries use a bare
 * `text/plain`; both are accepted, ASCII and Latin-1 renderings are not - they would decode into
 * mojibake for every text that needs more than ASCII.
 *
 * @param {Readonly<Record<string, string>> | undefined} formats Gutendex's media-type map.
 * @returns {string | undefined} The file URL, or `undefined` when there's no UTF-8 text.
 */
function plainTextUrl(formats: Readonly<Record<string, string>> | undefined): string | undefined {
  const entries = Object.entries(formats ?? {});
  const utf8 = entries.find(([type]) => /^text\/plain;\s*charset=utf-8/i.test(type));
  if (utf8) return utf8[1];
  return entries.find(([type]) => /^text\/plain$/i.test(type.trim()))?.[1];
}

/**
 * Every rendering of the book, as `Book.formats` lists them.
 *
 * @param {Readonly<Record<string, string>> | undefined} formats Gutendex's media-type map.
 * @returns {BookFormat[]} One entry per media type.
 */
function toFormats(formats: Readonly<Record<string, string>> | undefined): BookFormat[] {
  return Object.entries(formats ?? {}).map(([type, url]) => ({ type, url }));
}

/**
 * Names of a book's authors or translators.
 *
 * @param {readonly GutendexAuthor[] | undefined} authors People as Gutendex lists them.
 * @returns {string[]} The distinct names.
 */
function authorNames(authors: readonly GutendexAuthor[] | undefined): string[] {
  return uniqueStrings((authors ?? []).map((author) => author.name));
}

class Gutendex extends Provider {
  static readonly key = "gutendex";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      book: true,
      text: true,
      searchText: false,
      isbn: false,
      ratings: false,
    };
  }

  override async search(query: string, options?: SearchOptions): Promise<BookMatch[]> {
    assertQuery(query, Gutendex.key);
    const url = `${this.baseUrl}/books/${buildQuery({ search: query })}`;
    const data = await this.getJSON<GutendexResponse>(url);
    return (data.results ?? [])
      .slice(0, clampMaxResults(options?.limit, MAX_RESULTS))
      .map((book) => ({
        title: book.title ?? "",
        authors: authorNames(book.authors),
        id: book.id === undefined ? undefined : String(book.id),
        language: book.languages?.[0],
        url: bookUrl(book.id),
      }));
  }

  async book(query: BookQuery): Promise<Book> {
    const book = await this.locate(assertBookQuery(query, Gutendex.key));
    return {
      provider: Gutendex.key,
      title: book.title ?? "",
      authors: authorNames(book.authors),
      translators: authorNames(book.translators),
      languages: uniqueStrings(book.languages ?? []),
      subjects: uniqueStrings([...(book.subjects ?? []), ...(book.bookshelves ?? [])]).slice(
        0,
        MAX_SUBJECTS,
      ),
      description: book.summaries?.[0] ? normalizeText(book.summaries[0]) : undefined,
      cover: book.formats?.["image/jpeg"],
      formats: toFormats(book.formats),
      id: book.id === undefined ? undefined : String(book.id),
      url: bookUrl(book.id),
      attribution: "Text and catalog data from Project Gutenberg (gutenberg.org)",
    };
  }

  /**
   * Read a slice of a book's text.
   *
   * The Gutenberg licence header travels inside the file itself and stays there. Stripping it
   * would be cutting out the one thing that permits handing the text on at all.
   *
   * @param {BookQuery} query The book to read.
   * @param {TextOptions} [options] Offset and byte count.
   * @returns {Promise<BookText>} The slice.
   * @throws {NotFoundError} When the book has no UTF-8 plain text.
   */
  override async text(query: BookQuery, options?: TextOptions): Promise<BookText> {
    const book = await this.locate(assertBookQuery(query, Gutendex.key));
    const url = plainTextUrl(book.formats);
    if (!url) {
      throw new NotFoundError(
        `no UTF-8 plain-text rendering for "${book.title ?? query.title ?? query.id}"`,
        Gutendex.key,
      );
    }

    const slice = await this.readSlice(url, options);
    return {
      provider: Gutendex.key,
      title: book.title ?? "",
      authors: authorNames(book.authors),
      ...slice,
      url,
      attribution: "Public-domain text from Project Gutenberg (gutenberg.org)",
    };
  }

  /**
   * Resolve a query to one catalog record.
   *
   * @param {BookQuery} query A checked book query.
   * @returns {Promise<GutendexBook>} The record.
   * @throws {InvalidInputError} When the id isn't a Gutenberg book number.
   * @throws {UnsupportedOperationError} When the query carries only an ISBN.
   * @throws {NotFoundError} When the search finds nothing.
   */
  private async locate(query: BookQuery): Promise<GutendexBook> {
    if (query.id) {
      const id = query.id.trim();
      if (!BOOK_ID.test(id)) {
        throw new InvalidInputError(
          `id must be a Project Gutenberg book number, got "${query.id}"`,
          Gutendex.key,
        );
      }
      return await this.getJSON<GutendexBook>(`${this.baseUrl}/books/${id}/`);
    }

    if (!query.title) {
      throw new UnsupportedOperationError("isbn", Gutendex.key);
    }

    const search = searchTerms(query);
    const data = await this.getJSON<GutendexResponse>(
      `${this.baseUrl}/books/${buildQuery({ search })}`,
    );
    const book = data.results?.[0];
    if (!book) {
      throw new NotFoundError(search, Gutendex.key);
    }
    return book;
  }
}

register(Gutendex, DEFAULT_BASE_URL);
