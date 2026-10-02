/** Books error hierarchy */

/**
 * Base class for failures surfaced through Books.
 *
 * Every message passes through `sanitizeUrl` here, so a credential in a query string is redacted
 * at one boundary. No built-in provider sends one, but an externally registered provider can,
 * and the redaction has to be in place before its errors reach a log.
 */
export class BooksError extends Error {
  readonly provider?: string;

  constructor(message: string, provider?: string) {
    super(sanitizeUrl(message));
    this.name = "BooksError";
    this.provider = provider;
  }
}

/**
 * A path segment long enough to be a credential rather than an identifier.
 *
 * Vendors that key by path - Alchemy, Infura, QuickNode - put a 32-character token between two
 * slashes, where a query-parameter rule never sees it. The catalogs this library ships talk to
 * put identifiers there instead, and those must survive: a 404 that says
 * `/books/OL7524304M.json` is diagnosable, one that says `/REDACTED` is not. Length, a mix of
 * letters and digits, and the absence of a dot separate the two: `OL7524304M` is ten characters,
 * `lalka-tom-pierwszy.txt` has a dot and no digits, `9780441013593` has no letters.
 */
const CREDENTIAL_PATH_SEGMENT =
  /\/(?=[A-Za-z0-9_-]{24,}(?:\/|$))(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*/g;

/**
 * Strip API keys from URLs and URL-bearing text for safe error messages.
 *
 * Both shapes are covered because the message crosses a trust boundary: an MCP server and the
 * agent extensions hand this text to a model, not only to the operator who owns the key.
 *
 * @param {string} url URL or text that may carry one.
 * @returns {string} The text with credentials replaced by `REDACTED`.
 */
function sanitizeUrl(url: string): string {
  return url
    .replaceAll(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED")
    .replace(CREDENTIAL_PATH_SEGMENT, "/REDACTED");
}

/** HTTP failure with a redacted request URL in its message and a redacted response body. */
export class HTTPError extends BooksError {
  readonly statusCode: number;

  /** Request URL with secrets redacted. Non-enumerable to keep serialized errors compact. */
  readonly rawUrl: string;

  /** Response body, redacted in case the server echoes the request URL. */
  readonly body?: string;

  constructor(statusCode: number, url: string, body?: string, provider?: string) {
    super(`HTTP ${statusCode} from ${url}`, provider);
    this.statusCode = statusCode;
    if (body !== undefined) this.body = sanitizeUrl(body);
    this.rawUrl = sanitizeUrl(url);
    Object.defineProperty(this, "rawUrl", { enumerable: false });
    this.name = "HTTPError";
  }
}

/** Provider credentials were missing, rejected, or the provider refused the client. */
export class AuthError extends BooksError {
  constructor(provider: string, detail?: string) {
    super(`Authentication failed for ${provider}${detail ? `: ${detail}` : ""}`, provider);
    this.name = "AuthError";
  }
}

/** Provider demands payment or a higher plan for the request. */
export class PaymentError extends BooksError {
  readonly statusCode: number;

  constructor(provider: string, statusCode = 402) {
    super(`Payment required by ${provider} (HTTP ${statusCode})`, provider);
    this.statusCode = statusCode;
    this.name = "PaymentError";
  }
}

/** Provider refused a request because its rate limit was reached. */
export class RateLimitError extends BooksError {
  readonly retryAfter?: number;

  constructor(provider: string, retryAfter?: number) {
    super(
      `Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      provider,
    );
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
}

/** The provider's catalog has no such book. */
export class NotFoundError extends BooksError {
  constructor(resource: string, provider?: string) {
    super(`Not found: ${resource}`, provider);
    this.name = "NotFoundError";
  }
}

/**
 * A page or record was served but the fields this library needs were missing.
 *
 * This is the failure mode of the providers that read HTML: the site answered, so the request
 * was fine, but the layout no longer matches the selector. It is distinct from `NotFoundError`,
 * which means the catalog itself has no such entry.
 */
export class ParseError extends BooksError {
  /** Page whose markup could not be read. */
  readonly url?: string;

  constructor(detail: string, provider: string, url?: string) {
    super(`Could not read a book record from ${provider}: ${detail}`, provider);
    this.url = url;
    this.name = "ParseError";
  }
}

/** Provider backend does not expose the requested operation. */
export class UnsupportedOperationError extends BooksError {
  constructor(operation: string, provider: string) {
    super(`Operation "${operation}" not supported by ${provider}`, provider);
    this.name = "UnsupportedOperationError";
  }
}

/** Registry does not contain the requested provider name. */
export class UnknownProviderError extends BooksError {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`, provider);
    this.name = "UnknownProviderError";
  }
}

/** Caller input failed validation before any request was sent. */
export class InvalidInputError extends BooksError {
  constructor(message: string, provider?: string) {
    super(message, provider);
    this.name = "InvalidInputError";
  }
}

/** A response with an error status, as the HTTP client hands it to `normalizeError`. */
export class ResponseError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly headers: Headers;

  constructor(status: number, url: string, body: string, headers: Headers) {
    super(`HTTP ${status} from ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
    this.headers = headers;
    this.name = "ResponseError";
  }
}

/** What `normalizeError` reads from a failure, gathered once. */
interface Failure {
  readonly message: string;
  readonly lowerMessage: string;
  readonly status: number;
  readonly url?: string;
  readonly body?: string;
  readonly retryAfter?: string | null;
  readonly provider?: string;
}

/**
 * Map a 404 or a "not found" message.
 *
 * @param {Failure} failure The failure being classified.
 * @returns {BooksError | undefined} A `NotFoundError`, or `undefined` when this isn't one.
 */
function notFound(failure: Failure): BooksError | undefined {
  if (failure.status !== 404 && !failure.lowerMessage.includes("not found")) return undefined;
  return new NotFoundError(failure.url ?? failure.message, failure.provider);
}

/**
 * Map a 429 or a "rate limit" message, keeping `Retry-After` when it's a number.
 *
 * @param {Failure} failure The failure being classified.
 * @returns {BooksError | undefined} A `RateLimitError`, or `undefined` when this isn't one.
 */
function rateLimited(failure: Failure): BooksError | undefined {
  if (failure.status !== 429 && !failure.lowerMessage.includes("rate limit")) return undefined;
  const retryAfter = Number(failure.retryAfter ?? Number.NaN);
  return new RateLimitError(
    failure.provider ?? "unknown",
    Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
}

/**
 * Map a 402.
 *
 * @param {Failure} failure The failure being classified.
 * @returns {BooksError | undefined} A `PaymentError`, or `undefined` when this isn't one.
 */
function paymentRequired(failure: Failure): BooksError | undefined {
  if (failure.status !== 402) return undefined;
  return new PaymentError(failure.provider ?? "unknown", failure.status);
}

/**
 * Map a 401, a 403 or an "unauthorized" message.
 *
 * @param {Failure} failure The failure being classified.
 * @returns {BooksError | undefined} An `AuthError`, or `undefined` when this isn't one.
 */
function refused(failure: Failure): BooksError | undefined {
  const { status, url } = failure;
  if (status !== 401 && status !== 403 && !failure.lowerMessage.includes("unauthorized")) {
    return undefined;
  }
  const detail = url ? `HTTP ${status} from ${url}` : failure.message;
  return new AuthError(failure.provider ?? "unknown", detail);
}

const TRANSPORT_MESSAGES = ["econnrefused", "etimedout", "timeouterror"];

/**
 * Map any other HTTP status, a known URL, or a connection failure.
 *
 * @param {Failure} failure The failure being classified.
 * @returns {BooksError | undefined} An `HTTPError`, or `undefined` when this isn't one.
 */
function transport(failure: Failure): BooksError | undefined {
  const { status, url } = failure;
  const connection = TRANSPORT_MESSAGES.some((text) => failure.lowerMessage.includes(text));
  if (status <= 0 && !url && !connection) return undefined;
  return new HTTPError(status, url ?? "unknown", failure.body ?? failure.message, failure.provider);
}

/** Classifiers in the order they are tried; the first that answers wins. */
const CLASSIFIERS = [notFound, rateLimited, paymentRequired, refused, transport];

/**
 * Turn an unknown provider or transport failure into the Books error hierarchy.
 *
 * Existing `BooksError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 *
 * HTTP 403 maps onto `AuthError`, not `PaymentError`: on a public catalog a 403 means the
 * service refused the client - a blocked user agent, a country restriction - and none of these
 * backends charges for access.
 *
 * @param {unknown} error Whatever the provider or the transport threw.
 * @param {string} [provider] Provider the request was made for.
 * @param {string} [requestUrl] URL of the request that failed.
 * @returns {BooksError} The matching error from the hierarchy.
 */
export function normalizeError(error: unknown, provider?: string, requestUrl?: string): BooksError {
  if (error instanceof BooksError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const failure =
    error instanceof ResponseError
      ? responseFailure(error, provider, requestUrl)
      : messageFailure(message, provider, requestUrl);

  for (const classify of CLASSIFIERS) {
    const classified = classify(failure);
    if (classified) return classified;
  }
  return new BooksError(message, provider);
}

/**
 * Read a failure from a response the HTTP client rejected.
 *
 * @param {Readonly<ResponseError>} response The rejected response.
 * @param {string} [provider] Provider the request was made for.
 * @param {string} [requestUrl] URL of the request, when the caller knows it.
 * @returns {Failure} The fields the classifiers read.
 */
function responseFailure(
  response: Readonly<ResponseError>,
  provider?: string,
  requestUrl?: string,
): Failure {
  return {
    message: response.message,
    lowerMessage: response.message.toLowerCase(),
    status: response.status,
    url: requestUrl ?? response.url,
    body: response.body,
    retryAfter: response.headers.get("retry-after"),
    provider,
  };
}

/**
 * Read a failure from a bare message, taking the status from an `HTTP nnn` inside it.
 *
 * @param {string} message The error message.
 * @param {string} [provider] Provider the request was made for.
 * @param {string} [requestUrl] URL of the request, when the caller knows it.
 * @returns {Failure} The fields the classifiers read.
 */
function messageFailure(message: string, provider?: string, requestUrl?: string): Failure {
  return {
    message,
    lowerMessage: message.toLowerCase(),
    status: Number(/HTTP (\d{3})/i.exec(message)?.[1] ?? 0),
    url: requestUrl,
    provider,
  };
}
