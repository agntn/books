import { describe, expect, it } from "vitest";
import { FetchError } from "ofetch";
import {
  AuthError,
  BooksError,
  HTTPError,
  NotFoundError,
  PaymentError,
  RateLimitError,
  normalizeError,
} from "../../src/core/errors.ts";

/** Build the structured failure ofetch raises, which is what normalizeError reads. */
function fetchError(status: number, url: string, headers?: Record<string, string>): FetchError {
  const error = new FetchError(`[GET] "${url}": ${status}`);
  error.statusCode = status;
  error.request = url;
  error.response = { status, headers: new Headers(headers) } as FetchError["response"];
  return error;
}

describe("secret redaction", () => {
  it("redacts credentials in every message that reaches a caller", () => {
    const error = new BooksError("failed for https://x.test/v1?key=SECRET&q=dune");
    expect(error.message).toContain("key=REDACTED");
    expect(error.message).not.toContain("SECRET");
  });

  it("redacts the request URL and a response body that echoes it", () => {
    // Redaction targets credentials carried as query parameters - the shape a URL echoed back
    // in an error body takes. Free text in a body is left alone; mangling it would hide the
    // very message a caller needs to understand the failure.
    const error = new HTTPError(
      500,
      "https://x.test?api_key=SECRET",
      "denied for https://x.test?api_key=SECRET",
      "x",
    );
    expect(error.message).not.toContain("SECRET");
    expect(error.rawUrl).not.toContain("SECRET");
    expect(error.body).toContain("api_key=REDACTED");
    expect(error.body).not.toContain("SECRET");
  });

  it("keeps rawUrl out of serialized errors", () => {
    const error = new HTTPError(500, "https://x.test", undefined, "x");
    expect(Object.keys({ ...error })).not.toContain("rawUrl");
  });
});

describe("normalizeError", () => {
  it("passes an existing Books error through untouched", () => {
    const original = new NotFoundError("book", "bn");
    expect(normalizeError(original, "openlibrary")).toBe(original);
  });

  it("maps statuses onto the hierarchy by structured status, not message text", () => {
    expect(normalizeError(fetchError(404, "https://x.test"), "bn")).toBeInstanceOf(NotFoundError);
    expect(normalizeError(fetchError(401, "https://x.test"), "bn")).toBeInstanceOf(AuthError);
    expect(normalizeError(fetchError(402, "https://x.test"), "bn")).toBeInstanceOf(PaymentError);
    // A public catalog answering 403 has refused the client, not asked it to pay.
    expect(normalizeError(fetchError(403, "https://x.test"), "bn")).toBeInstanceOf(AuthError);
    expect(normalizeError(fetchError(500, "https://x.test"), "bn")).toBeInstanceOf(HTTPError);
  });

  it("reads retry-after off the response headers", () => {
    const error = normalizeError(
      fetchError(429, "https://x.test", { "retry-after": "30" }),
      "openlibrary",
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(30);
  });

  it("keeps the status and provider of a server failure", () => {
    const error = normalizeError(fetchError(503, "https://gutendex.com/books"), "gutendex");
    expect((error as HTTPError).statusCode).toBe(503);
    expect(error.provider).toBe("gutendex");
  });

  it("turns a transport failure into an HTTPError with no status", () => {
    const error = normalizeError(new Error("ETIMEDOUT"), "gutendex");
    expect(error).toBeInstanceOf(HTTPError);
    expect((error as HTTPError).statusCode).toBe(0);
  });

  it("wraps anything else as the base error", () => {
    const error = normalizeError("something odd", "bn");
    expect(error.name).toBe("BooksError");
    expect(error.message).toBe("something odd");
  });
});
