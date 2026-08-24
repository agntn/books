/**
 * Open Library provider - the Internet Archive's open catalog of books
 *
 * No API key. The catalog separates a *work* (the book as a text, `OL…W`) from an *edition* (a
 * particular printing, `OL…M`); ISBNs, page counts and publishers belong to editions, while
 * blurbs, subjects and reader scores belong to works. A record here is stitched from both.
 *
 * API: https://openlibrary.org/developers/api (REST, JSON)
 */

import type {
  Book,
  BookMatch,
  BookQuery,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
} from "../core/types.ts";
import { Provider, assertBookQuery, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { HTTPError, InvalidInputError, NotFoundError } from "../core/errors.ts";
import { toIsbn10, toIsbn13 } from "../core/isbn.ts";
import { register } from "../core/registry.ts";
import { normalizeText, parseYear, uniqueStrings } from "../core/text.ts";
import { clampMaxResults, toRating } from "../core/types.ts";

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

/** Open Library's rating scale. */
const RATING_SCALE = 5;

/** A blurb is either a string or a typed text node, depending on the record's age. */
type OpenLibraryText = string | { value?: string };

interface OpenLibrarySearchDocument {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  language?: string[];
  cover_i?: number;
  ratings_average?: number;
  ratings_count?: number;
}

interface OpenLibrarySearchResponse {
  numFound?: number;
  docs?: OpenLibrarySearchDocument[];
}

interface OpenLibraryEdition {
  key?: string;
  title?: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  isbn_10?: string[];
  isbn_13?: string[];
  languages?: { key?: string }[];
  covers?: number[];
  series?: string[];
  subjects?: string[];
  description?: OpenLibraryText;
  works?: { key?: string }[];
  authors?: { key?: string }[];
}

interface OpenLibraryWork {
  key?: string;
  title?: string;
  subjects?: string[];
  description?: OpenLibraryText;
  covers?: number[];
  first_publish_date?: string;
  authors?: { author?: { key?: string } }[];
}

interface OpenLibraryRatings {
  summary?: { average?: number | null; count?: number | null };
}

interface OpenLibraryAuthor {
  name?: string;
  personal_name?: string;
}

/** Unwrap a description that may be a bare string or a `/type/text` node. */
function readText(value: OpenLibraryText | undefined): string | undefined {
  const text = typeof value === "string" ? value : value?.value;
  return text ? normalizeText(text) : undefined;
}

/** `/works/OL893414W` and `OL893414W` both name the same record. */
function keyId(key: string | undefined): string | undefined {
  return key?.split("/").filter(Boolean).pop();
}

/** `/languages/eng` carries the code in its last segment. */
function languageCodes(languages: { key?: string }[] | undefined): string[] {
  return uniqueStrings((languages ?? []).map((language) => keyId(language.key)));
}

/** First ISBN of a search match that passes its check digit, preferred in 13-digit form. */
function pickIsbn(isbns: string[] | undefined): string | undefined {
  for (const isbn of isbns ?? []) {
    const isbn13 = toIsbn13(isbn);
    if (isbn13) return isbn13;
  }
  return undefined;
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

  async book(query: BookQuery): Promise<Book> {
    const checked = assertBookQuery(query, OpenLibrary.key);
    const { edition, work: found } = await this.locate(checked);

    const workKey = found?.key ?? edition?.works?.[0]?.key;
    const editionAuthorKeys = (edition?.authors ?? [])
      .map((author) => author.key)
      .filter((key): key is string => Boolean(key));

    const [work, ratings, earlyAuthors] = await Promise.all([
      found ?? (workKey ? this.fetchWork(workKey) : undefined),
      workKey ? this.fetchRatings(workKey) : undefined,
      editionAuthorKeys.length > 0 ? this.fetchAuthors(editionAuthorKeys) : undefined,
    ]);

    const authors =
      earlyAuthors ??
      (await this.fetchAuthors(
        (work?.authors ?? [])
          .map((entry) => entry.author?.key)
          .filter((key): key is string => Boolean(key)),
      ));

    const isbn13 = toIsbn13(edition?.isbn_13?.[0] ?? edition?.isbn_10?.[0]);
    const cover = edition?.covers?.[0] ?? work?.covers?.[0];
    const canonicalKey = edition?.key ?? work?.key;

    return {
      provider: OpenLibrary.key,
      title: edition?.title ?? work?.title ?? "",
      subtitle: edition?.subtitle,
      authors,
      year: parseYear(edition?.publish_date ?? work?.first_publish_date),
      published: edition?.publish_date,
      publisher: edition?.publishers?.[0],
      isbn10: toIsbn10(edition?.isbn_10?.[0]),
      isbn13,
      pages: edition?.number_of_pages,
      languages: languageCodes(edition?.languages),
      subjects: uniqueStrings([...(work?.subjects ?? []), ...(edition?.subjects ?? [])]).slice(
        0,
        25,
      ),
      series: edition?.series?.[0],
      description: readText(work?.description ?? edition?.description),
      cover: cover === undefined ? undefined : `${COVERS_BASE_URL}/b/id/${cover}-L.jpg`,
      rating: ratings,
      id: keyId(canonicalKey),
      url: canonicalKey ? `${this.baseUrl}${canonicalKey}` : undefined,
      attribution: "Catalog data from Open Library (openlibrary.org)",
    };
  }

  /** Find the edition or work a query names, in one request where the catalog allows one. */
  private async locate(
    query: BookQuery,
  ): Promise<{ edition?: OpenLibraryEdition; work?: OpenLibraryWork }> {
    if (query.isbn) {
      // `/isbn/{isbn}` redirects to the edition record; ofetch follows it.
      return {
        edition: await this.getJSON<OpenLibraryEdition>(`${this.baseUrl}/isbn/${query.isbn}.json`),
      };
    }

    if (query.id) {
      const id = keyId(query.id)?.toUpperCase() ?? "";
      if (/^OL\d+M$/.test(id)) {
        return {
          edition: await this.getJSON<OpenLibraryEdition>(`${this.baseUrl}/books/${id}.json`),
        };
      }
      if (/^OL\d+W$/.test(id)) {
        return { work: await this.fetchWork(`/works/${id}`) };
      }
      throw new InvalidInputError(
        `id must be an Open Library work (OL…W) or edition (OL…M) key, got "${query.id}"`,
        OpenLibrary.key,
      );
    }

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

  private fetchWork(key: string): Promise<OpenLibraryWork> {
    return this.getJSON<OpenLibraryWork>(`${this.baseUrl}/${key.replace(/^\//, "")}.json`);
  }

  /**
   * Reader scores for a work, or `undefined` when it has none.
   *
   * Scores are an ornament on a bibliographic record: a work nobody has rated answers 404 here,
   * and that must not take the record down with it.
   */
  private async fetchRatings(key: string): Promise<Book["rating"]> {
    try {
      const data = await this.getJSON<OpenLibraryRatings>(
        `${this.baseUrl}/${key.replace(/^\//, "")}/ratings.json`,
      );
      return toRating(
        data.summary?.average ?? undefined,
        RATING_SCALE,
        data.summary?.count ?? undefined,
      );
    } catch (error) {
      // A work nobody rated answers 404, and that must not take the record down with it. A rate
      // limit is a different matter: swallowing it would report a book as unrated when the
      // catalog is simply refusing requests, so it travels on.
      if (error instanceof NotFoundError || error instanceof HTTPError) return undefined;
      throw error;
    }
  }

  /** Resolve author keys to names, up to `MAX_AUTHOR_LOOKUPS` of them. */
  private async fetchAuthors(keys: string[]): Promise<string[]> {
    const records = await Promise.all(
      keys
        .slice(0, MAX_AUTHOR_LOOKUPS)
        .map((key) =>
          this.getJSON<OpenLibraryAuthor>(`${this.baseUrl}/${key.replace(/^\//, "")}.json`),
        ),
    );
    return uniqueStrings(records.map((author) => author.name ?? author.personal_name));
  }
}

register(OpenLibrary, DEFAULT_BASE_URL);
