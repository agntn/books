/**
 * Wolne Lektury provider - the Polish free-licence library, with the texts themselves
 *
 * No API key. Records come from the JSON API, but the API has no search endpoint, so `search()`
 * reads the site's result page and every match carries the slug the API is keyed by. Volumes of
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
  name?: string;
  slug?: string;
}

interface WolneLekturyBook {
  title?: string;
  url?: string;
  language?: string;
  authors?: WolneLekturyName[];
  translators?: WolneLekturyName[];
  epochs?: WolneLekturyName[];
  genres?: WolneLekturyName[];
  kinds?: WolneLekturyName[];
  cover?: string;
  simple_cover?: string;
  txt?: string;
  pdf?: string;
  epub?: string;
  mobi?: string;
  fb2?: string;
  html?: string;
  isbn_pdf?: string;
  isbn_epub?: string;
  isbn_mobi?: string;
  children?: { slug?: string; title?: string }[];
  parent?: { slug?: string } | null;
}

/** Slug out of `/katalog/lektura/lalka/`. */
function slugFromHref(href: string | undefined): string | undefined {
  return href?.split("/").filter(Boolean).pop();
}

function names(values: WolneLekturyName[] | undefined): string[] {
  return uniqueStrings((values ?? []).map((value) => value.name));
}

function toFormats(book: WolneLekturyBook): BookFormat[] {
  const files: [string, string | undefined][] = [
    ["text/plain; charset=utf-8", book.txt],
    ["application/epub+zip", book.epub],
    ["application/pdf", book.pdf],
    ["application/x-mobipocket-ebook", book.mobi],
    ["application/x-fictionbook+xml", book.fb2],
    ["text/html", book.html],
  ];
  return files
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
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
      const title = link?.text.replace(/\s+/g, " ").trim();
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

  /** Resolve a query to one catalog record, keeping the slug it was found under. */
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

  /** First search hit for a title query, since the API itself cannot search. */
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
