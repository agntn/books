/** Fan-out helpers: compare every provider, or walk them until one has the book. */

import type { Provider } from "./provider.ts";
import type { Book, BookMatch, BookQuery, BookText, SearchOptions, TextOptions } from "./types.ts";
import { BooksError, NotFoundError, normalizeError } from "./errors.ts";
import { assertBookQuery, requireOperation } from "./provider.ts";
import { create, providers } from "./registry.ts";
import { usableProviders } from "./resolve.ts";

/**
 * One provider's contribution to a comparison: either its result or its normalized failure.
 *
 * Failures stay in the list on purpose - a catalog that has no such book, or does not serve the
 * operation, is itself the answer when comparing backends.
 */
export type ProviderOutcome<T> =
  | { provider: string; result: T; error?: never }
  | { provider: string; error: BooksError; result?: never };

/** JSON-safe view of outcomes: errors reduced to their messages. */
export interface SerializedOutcome<T> {
  provider: string;
  result?: T;
  error?: string;
}

async function runAll<T>(run: (provider: Provider) => Promise<T>): Promise<ProviderOutcome<T>[]> {
  return Promise.all(
    providers().map(async (name): Promise<ProviderOutcome<T>> => {
      try {
        return { provider: name, result: await run(create(name)) };
      } catch (error) {
        return { provider: name, error: normalizeError(error, name) };
      }
    }),
  );
}

/**
 * Search every registered provider in parallel.
 *
 * @example
 *   ```ts
 *   import { searchAll } from "@agntn/books";
 *
 *   const outcomes = await searchAll("dune herbert", { limit: 3 });
 *   ```
 */
export function searchAll(
  query: string,
  options?: SearchOptions,
): Promise<ProviderOutcome<BookMatch[]>[]> {
  return runAll((provider) => requireOperation(provider, "search")(query, options));
}

/**
 * Fetch one book's record from every registered provider in parallel.
 *
 * Catalogs disagree about page counts, publication years and even titles, and each describes the
 * edition it happens to hold; comparing them is the point.
 */
export function bookAll(query: BookQuery): Promise<ProviderOutcome<Book>[]> {
  return runAll((provider) => requireOperation(provider, "book")(query));
}

/** A successful fallback walk: the result plus the provider that finally had it. */
export interface FallbackResult<T> {
  /** Registry key of the provider that answered */
  provider: string;
  /** What that provider returned */
  result: T;
  /** Providers tried before it, with the reason each was passed over */
  skipped: { provider: string; error: string }[];
}

/**
 * Failures that mean "ask someone else" rather than "something is wrong".
 *
 * Matched by name rather than by `instanceof`: the registry accepts providers registered from
 * outside this package, and one loaded through a second copy of the module would throw errors
 * from a different set of classes that no `instanceof` here would recognize.
 *
 * `InvalidInputError` belongs here because provider ids have provider-specific shapes: `84` is a
 * Gutenberg book and gibberish to Open Library, whose ids look like `OL893414W`. The walk
 * validates the query itself before it starts, so an input error raised inside a provider is a
 * statement about that provider's id format rather than about the caller.
 */
const SKIPPABLE_ERRORS = new Set([
  "NotFoundError",
  "AuthError",
  "PaymentError",
  "UnsupportedOperationError",
  "ParseError",
  "InvalidInputError",
]);

/**
 * A backend that is down is skipped; one that is slow stops the walk.
 *
 * Gutendex answers a search in under a second most of the time, and returns 503 or stops
 * answering at all when it is loaded - both were seen minutes apart during this library's API
 * audit. A 5xx costs nothing to pass over, so the walk moves on and records it in `skipped`,
 * where the caller can see the backend failed rather than lacked the book. A timeout is
 * different: five providers each given fifteen seconds is over a minute of waiting, so the walk
 * stops and says what happened.
 */
function isSkippable(error: BooksError): boolean {
  if (SKIPPABLE_ERRORS.has(error.name)) return true;
  const status = (error as { statusCode?: number }).statusCode;
  return error.name === "HTTPError" && status !== undefined && status >= 500;
}

async function walk<T>(
  order: string[],
  run: (provider: Provider) => Promise<T>,
  describe: () => string,
): Promise<FallbackResult<T>> {
  const skipped: { provider: string; error: string }[] = [];
  let lastError: BooksError | undefined;

  for (const name of order) {
    try {
      return { provider: name, result: await run(create(name)), skipped };
    } catch (error) {
      const normalized = normalizeError(error, name);
      lastError = normalized;
      if (!isSkippable(normalized)) throw normalized;
      skipped.push({ provider: name, error: normalized.message });
    }
  }

  throw lastError ?? new NotFoundError(describe());
}

/** Human-readable form of a query, for the error raised when nobody had the book. */
function describeQuery(query: BookQuery): string {
  return (
    [query.isbn && `ISBN ${query.isbn}`, query.title, query.author, query.id && `id ${query.id}`]
      .filter(Boolean)
      .join(" / ") || "book"
  );
}

/**
 * Ask providers for a book in order until one has it.
 *
 * No catalog holds everything: Open Library is thin on Polish editions, the National Library
 * holds almost nothing published abroad, and the two public-domain libraries only know books old
 * enough to be free. A missing book, an unsupported operation, or a page that no longer parses
 * moves the walk on; a rate limit or a transport failure stops it, because retrying those
 * elsewhere hides a real problem.
 *
 * An ISBN query walks only the catalogs that can look an ISBN up - the others would search their
 * text index for a number and answer with whatever it happened to match.
 *
 * @example
 *   ```ts
 *   import { bookWithFallback } from "@agntn/books";
 *
 *   const { provider, result } = await bookWithFallback({ isbn: "9780441013593" });
 *   ```
 *
 * @throws {BooksError} The last failure, when no provider could serve the book.
 */
export async function bookWithFallback(
  query: BookQuery,
  order: string[] = query.isbn ? usableProviders("isbn") : usableProviders("book"),
): Promise<FallbackResult<Book>> {
  // `async` so a rejected query returns a rejected promise. A caller holding a promise catches
  // with `.catch`, and a function that sometimes throws synchronously walks straight past that.
  const checked = assertBookQuery(query, "books");
  return walk(
    order,
    (provider) => requireOperation(provider, "book")(checked),
    () => describeQuery(checked),
  );
}

/**
 * Ask the public-domain libraries for a book's text in order until one has it.
 *
 * @throws {BooksError} The last failure, when no library could serve the text.
 */
export async function textWithFallback(
  query: BookQuery,
  options?: TextOptions,
  order: string[] = usableProviders("text"),
): Promise<FallbackResult<BookText>> {
  const checked = assertBookQuery(query, "books");
  return walk(
    order,
    (provider) => requireOperation(provider, "text")(checked, options),
    () => describeQuery(checked),
  );
}

/** Reduce outcomes to a JSON-safe shape for MCP and AI tool results. */
export function serializeOutcomes<T>(outcomes: ProviderOutcome<T>[]): SerializedOutcome<T>[] {
  return outcomes.map((outcome) =>
    outcome.error
      ? { provider: outcome.provider, error: outcome.error.message }
      : { provider: outcome.provider, result: outcome.result },
  );
}
