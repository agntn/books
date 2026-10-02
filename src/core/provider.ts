import type {
  Book,
  BookMatch,
  BookQuery,
  BookText,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
  TextOptions,
  TextSearchOptions,
  TextSearchResult,
} from "./types.ts";
import { getJSON, getText, readTextSlice } from "./client.ts";
import type { TextSlice } from "./client.ts";
import { InvalidInputError, UnsupportedOperationError } from "./errors.ts";
import { assertIsbn } from "./isbn.ts";
import { clampTextBytes } from "./types.ts";

/**
 * Common API for book backends.
 *
 * A provider holds backend configuration, not a book. Every provider serves `book()`; `search()`
 * and `text()` are optional, so check `capabilities` - or go through `requireOperation` - before
 * using one. Only the public-domain libraries carry texts; the catalogs describe books they have
 * no right to hand out.
 */
export abstract class Provider {
  private readonly timeout: number | undefined;

  constructor(config: ProviderConfig = {}) {
    this.timeout = config.timeout;
  }

  /** Registry key owned by the concrete class. */
  get name(): string {
    return (this.constructor as ProviderConstructor).key;
  }

  /** Operations and result kinds this provider can actually serve. */
  abstract get capabilities(): ProviderCapabilities;

  /** Fetch the bibliographic record of one book. */
  abstract book(query: BookQuery): Promise<Book>;

  /** List books matching a free-form query, best match first. */
  search?(query: string, options?: SearchOptions): Promise<BookMatch[]>;

  /** Read a slice of a book's full text. */
  text?(query: BookQuery, options?: TextOptions): Promise<BookText>;

  /** Find a phrase inside scanned books, best match first. */
  searchText?(query: string, options?: TextSearchOptions): Promise<TextSearchResult>;

  /** Provider-attributed GET for JSON; a configured timeout beats the `defaultTimeout`. */
  protected getJSON<T>(url: string, defaultTimeout?: number): Promise<T> {
    return getJSON<T>(url, { timeout: this.timeout ?? defaultTimeout, provider: this.name });
  }

  /** Execute a provider-attributed GET request for an HTML page. */
  protected getText(url: string): Promise<string> {
    return getText(url, { timeout: this.timeout, provider: this.name });
  }

  /**
   * Read one slice of a text file, with the caller's bounds clamped to the shared ceiling.
   *
   * The URL comes out of a provider's own response - Gutenberg's `formats` map, the Wolne
   * Lektury `txt` field - so it is checked before it is fetched. A catalog that started handing
   * out `file://` or a host on the caller's network would otherwise have this library read it.
   */
  protected readSlice(url: string, options?: TextOptions): Promise<TextSlice> {
    assertHttpUrl(url, this.name);
    return readTextSlice(
      url,
      {
        offset: Math.max(0, Math.round(options?.offset ?? 0)),
        maxBytes: clampTextBytes(options?.maxBytes),
      },
      { timeout: this.timeout, provider: this.name },
    );
  }
}

/** Concrete provider class accepted by the registry. */
export interface ProviderConstructor {
  /** Stable registry key owned by the concrete class. */
  readonly key: string;
  /**
   * Environment variable holding this provider's credential, or absent when it needs none.
   *
   * Auto-selection reads it off the class, so a provider registered from outside this package
   * takes part in credential-aware selection on the same terms as a built-in one. Every built-in
   * provider is a public catalog and declares none.
   */
  readonly envKey?: string;
  new (config: ProviderConfig): Provider;
}

/**
 * Reject a file URL that is not plain HTTP(S) before fetching it.
 *
 * @throws {InvalidInputError} When the URL is malformed or uses another scheme.
 */
export function assertHttpUrl(url: string, provider: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidInputError(`not a usable file URL: ${url}`, provider);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidInputError(`refusing to read a ${parsed.protocol} URL: ${url}`, provider);
  }
  return url;
}

/**
 * Reject an empty or whitespace-only search query before any request is sent.
 *
 * @throws {InvalidInputError} When `query` carries no content.
 */
export function assertQuery(query: string, provider: string): void {
  if (!query.trim()) {
    throw new InvalidInputError("query is empty", provider);
  }
}

/**
 * Reject a book query that cannot identify a book, and normalize the ISBN in one that can.
 *
 * The fields are alternatives: an ISBN, a provider-native id, or a title. An author on its own
 * is not one - "a book by Herbert" names a shelf, not a book - so it is rejected here rather
 * than turned into whichever title a catalog happens to sort first.
 *
 * @returns The query with a normalized `isbn` when it carried one.
 * @throws {InvalidInputError} When no field identifies a book, or the ISBN fails its check digit.
 */
export function assertBookQuery(query: BookQuery, provider: string): BookQuery {
  const isbn = query.isbn?.trim();
  const id = query.id?.trim();
  const title = query.title?.trim();

  if (!isbn && !id && !title) {
    throw new InvalidInputError(
      query.author?.trim()
        ? "author alone cannot identify a book: pass a title, an isbn, or a provider id"
        : "query needs one of isbn, id, or title",
      provider,
    );
  }

  return isbn ? { ...query, isbn: assertIsbn(isbn, provider) } : query;
}

/**
 * The free-text query a provider falls back to when it can only search, not look up.
 *
 * Three of the five backends reach their records through their own search box, and each built
 * this string for itself.
 */
export function searchTerms(query: BookQuery): string {
  return [query.title, query.author].filter(Boolean).join(" ");
}

/** Operation names accepted by `requireOperation` - one per provider method. */
export type ProviderOperation = "search" | "book" | "text" | "searchText";

/**
 * Return a bound provider method after checking its capability flag.
 *
 * The runtime check covers both halves of the contract: a provider that advertises an operation
 * it never implemented fails here rather than as `undefined is not a function` deeper in a call.
 *
 * @throws {UnsupportedOperationError} When the provider does not serve the operation.
 */
export function requireOperation<K extends ProviderOperation>(
  provider: Provider,
  operation: K,
): NonNullable<Provider[K]> {
  const method = provider[operation];
  if (provider.capabilities[operation] !== true || typeof method !== "function") {
    throw new UnsupportedOperationError(operation, provider.name);
  }
  return method.bind(provider) as NonNullable<Provider[K]>;
}
