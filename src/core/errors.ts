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
 */
function sanitizeUrl(url: string): string {
  return url
    .replace(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED")
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

/**
 * Turn an unknown provider or transport failure into the Books error hierarchy.
 *
 * Existing `BooksError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 *
 * HTTP 403 maps onto `AuthError`, not `PaymentError`: on a public catalog a 403 means the
 * service refused the client - a blocked user agent, a country restriction - and none of these
 * backends charges for access.
 */
export function normalizeError(error: unknown, provider?: string, requestUrl?: string): BooksError {
  if (error instanceof BooksError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  const response = error instanceof ResponseError ? error : undefined;
  const statusMatch = message.match(/HTTP (\d{3})/i);
  const status = response?.status ?? Number(statusMatch?.[1] ?? 0);
  const url = requestUrl ?? response?.url;
  const resource = url ?? message;

  if (status === 404 || lowerMessage.includes("not found")) {
    return new NotFoundError(resource, provider);
  }

  if (status === 429 || lowerMessage.includes("rate limit")) {
    const retryAfter = Number(response?.headers.get("retry-after") ?? Number.NaN);
    return new RateLimitError(
      provider ?? "unknown",
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }

  if (status === 402) {
    return new PaymentError(provider ?? "unknown", status);
  }

  if (status === 401 || status === 403 || lowerMessage.includes("unauthorized")) {
    const detail = url ? `HTTP ${status} from ${url}` : message;
    return new AuthError(provider ?? "unknown", detail);
  }

  if (
    status > 0 ||
    url ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("timeouterror")
  ) {
    return new HTTPError(status, url ?? "unknown", response?.body ?? message, provider);
  }

  return new BooksError(message, provider);
}
