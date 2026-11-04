/**
 * Wolne Lektury provider - the Polish free-licence library, with the texts themselves
 *
 * No API key. Records come from the JSON API, but the API has no search endpoint (`?search=` on
 * `/api/books/` is ignored and hands back the head of the catalog), so `search()` reads the
 * site's result page and every match carries the slug the API is keyed by. Volumes of
 * a long novel are separate records: the parent holds the series and the children hold the text.
 *
 * API: https://wolnelektury.pl/api/books/{slug}/ (JSON), search page at /szukaj/
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
import { toIsbn13 } from "../core/isbn.ts";
import { parseHtml } from "../core/html.ts";
import { register } from "../core/registry.ts";
import { uniqueStrings } from "../core/text.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://wolnelektury.pl";

/** One book card on the search page: cover, author heading, title heading, category line. */
const RESULT_SELECTOR = "article.l-books__item";
const RESULT_TITLE_SELECTOR = 'h2 a[href^="/katalog/lektura/"]';
const RESULT_AUTHOR_SELECTOR = 'h3 a[href^="/katalog/autor/"]';

/** A record id here is the catalog slug, as `/katalog/lektura/{slug}/` spells it. */
const BOOK_SLUG = /^[a-z0-9-]+$/;

interface WolneLekturyName {
  readonly name?: string;
  readonly slug?: string;
}

interface WolneLekturyBook {
  readonly title?: string;
  readonly url?: string;
  readonly language?: string;
  readonly authors?: readonly WolneLekturyName[];
  readonly translators?: readonly WolneLekturyName[];
  readonly epochs?: readonly WolneLekturyName[];
  readonly genres?: readonly WolneLekturyName[];
  readonly kinds?: readonly WolneLekturyName[];
  readonly cover?: string;
  readonly simple_cover?: string;
  readonly txt?: string;
  readonly pdf?: string;
  readonly epub?: string;
  readonly mobi?: string;
  readonly fb2?: string;
  readonly html?: string;
  readonly isbn_pdf?: string;
  readonly isbn_epub?: string;
  readonly isbn_mobi?: string;
  readonly children?: readonly Readonly<{ slug?: string; title?: string }>[];
  readonly parent?: Readonly<{ slug?: string }> | null;
}

/**
 * Slug out of `/katalog/lektura/lalka/`.
 *
 * @param {string | undefined} href A catalog link.
 * @returns {string | undefined} Its last path segment.
 */
function slugFromHref(href: string | undefined): string | undefined {
  return href?.split("/").filter(Boolean).pop();
}

/**
 * Names of the people or categories a record lists.
 *
 * @param {readonly WolneLekturyName[] | undefined} values Named entries from the API.
 * @returns {string[]} The distinct names.
 */
function names(values: readonly WolneLekturyName[] | undefined): string[] {
  return uniqueStrings((values ?? []).map((value) => value.name));
}

/**
 * The files the library serves for a book.
 *
 * @param {WolneLekturyBook} book The API record.
 * @returns {BookFormat[]} One entry per file the record links.
 */
function toFormats(book: WolneLekturyBook): BookFormat[] {
  const files: (readonly [string, string | undefined])[] = [
    ["text/plain; charset=utf-8", book.txt],
    ["application/epub+zip", book.epub],
    ["application/pdf", book.pdf],
    ["application/x-mobipocket-ebook", book.mobi],
    ["application/x-fictionbook+xml", book.fb2],
    ["text/html", book.html],
  ];
  return files
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .map(([type, url]) => ({ type, url }));
}

class WolneLektury extends Provider {
  static readonly key = "wolnelektury";

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
    assertQuery(query, WolneLektury.key);
    const url = `${this.baseUrl}/szukaj/${buildQuery({ q: query.trim() })}`;
    const page = parseHtml(await this.getText(url));
    const limit = clampMaxResults(options?.limit, MAX_RESULTS);
    const matches: BookMatch[] = [];
    for (const card of page.querySelectorAll(RESULT_SELECTOR)) {
      const link = card.querySelector(RESULT_TITLE_SELECTOR);
      const slug = slugFromHref(link?.getAttribute("href"));
      const title = link?.text.replaceAll(/\s+/g, " ").trim();
      if (!slug || !title) continue;
      matches.push({
        title,
        authors: uniqueStrings([card.querySelector(RESULT_AUTHOR_SELECTOR)?.text.trim()]),
        id: slug,
        language: "pol",
        url: `${this.baseUrl}/katalog/lektura/${slug}/`,
      });
      if (matches.length >= limit) break;
    }
    return matches;
  }

  /**
   * Fetch one record.
   *
   * The digital editions carry their own ISBNs, one per file format. The EPUB is the one a
   * reader is most likely to be holding, so that is the one the record reports.
   *
   * @param {BookQuery} query The book to look up.
   * @returns {Promise<Book>} The record.
   */
  async book(query: BookQuery): Promise<Book> {
    const { slug, book } = await this.locate(assertBookQuery(query, WolneLektury.key));
    return {
      provider: WolneLektury.key,
      title: book.title ?? "",
      authors: names(book.authors),
      translators: names(book.translators),
      isbn13: toIsbn13(book.isbn_epub ?? book.isbn_pdf ?? book.isbn_mobi),
      languages: uniqueStrings([book.language]),
      subjects: uniqueStrings([...names(book.epochs), ...names(book.genres), ...names(book.kinds)]),
      series: book.parent?.slug,
      cover: book.cover || book.simple_cover || undefined,
      formats: toFormats(book),
      id: slug,
      url: book.url ?? `${this.baseUrl}/katalog/lektura/${slug}/`,
      attribution: "Free-licence text from Wolne Lektury (wolnelektury.pl)",
    };
  }

  /**
   * Read a slice of a book's text.
   *
   * A multi-volume work is a shell: the text lives in the volumes, which are records of their
   * own. Naming them beats "not found" for a book the library plainly has.
   *
   * @param {BookQuery} query The book to read.
   * @param {TextOptions} [options] Offset and byte count.
   * @returns {Promise<BookText>} The slice.
   * @throws {NotFoundError} When the record has no plain text, naming its volumes if it has them.
   */
  override async text(query: BookQuery, options?: TextOptions): Promise<BookText> {
    const { slug, book } = await this.locate(assertBookQuery(query, WolneLektury.key));
    if (!book.txt) {
      const volumes = uniqueStrings((book.children ?? []).map((child) => child.slug));
      throw new NotFoundError(
        volumes.length > 0
          ? `"${book.title ?? slug}" has no text of its own; read its volumes: ${volumes.join(", ")}`
          : `no plain-text file for "${book.title ?? slug}"`,
        WolneLektury.key,
      );
    }

    const slice = await this.readSlice(book.txt, options);
    return {
      provider: WolneLektury.key,
      title: book.title ?? "",
      authors: names(book.authors),
      ...slice,
      url: book.txt,
      attribution: "Free-licence text from Wolne Lektury (wolnelektury.pl)",
    };
  }

  /**
   * Resolve a query to one catalog record, keeping the slug it was found under.
   *
   * @param {BookQuery} query A checked book query.
   * @returns {Promise<{ slug: string; book: WolneLekturyBook }>} The slug and the record.
   * @throws {InvalidInputError} When the id isn't a catalog slug.
   */
  private async locate(query: BookQuery): Promise<{ slug: string; book: WolneLekturyBook }> {
    const slug = query.id?.trim() ?? (await this.searchSlug(query));
    if (!BOOK_SLUG.test(slug)) {
      throw new InvalidInputError(
        `id must be a Wolne Lektury catalog slug, got "${query.id}"`,
        WolneLektury.key,
      );
    }
    return {
      slug,
      book: await this.getJSON<WolneLekturyBook>(`${this.baseUrl}/api/books/${slug}/`),
    };
  }

  /**
   * First search hit for a title query, since the API itself cannot search.
   *
   * @param {BookQuery} query A checked book query.
   * @returns {Promise<string>} The slug of the first hit.
   * @throws {UnsupportedOperationError} When the query carries only an ISBN.
   * @throws {NotFoundError} When the search finds nothing.
   */
  private async searchSlug(query: BookQuery): Promise<string> {
    if (!query.title) {
      throw new UnsupportedOperationError("isbn", WolneLektury.key);
    }
    const search = searchTerms(query);
    const [match] = await this.search(search, { limit: 1 });
    if (!match?.id) {
      throw new NotFoundError(search, WolneLektury.key);
    }
    return match.id;
  }
}

register(WolneLektury, DEFAULT_BASE_URL);
