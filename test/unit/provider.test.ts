import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError } from "../../src/core/errors.ts";
import { Provider, assertBookQuery, assertHttpUrl } from "../../src/core/provider.ts";
import type { ProviderCapabilities } from "../../src/core/types.ts";
import type { Book, BookQuery, BookText, TextOptions } from "../../src/core/types.ts";
import { FAKE_TEXT_BYTES, stubRoutes } from "../helpers.ts";

/** Reads whatever URL it is handed, the way the public-domain providers do. */
class Reader extends Provider {
  static readonly key = "reader";

  get capabilities(): ProviderCapabilities {
    return { search: false, book: true, text: true, isbn: false, ratings: false };
  }

  async book(): Promise<Book> {
    return { provider: Reader.key, title: "", authors: [], languages: [], subjects: [] };
  }

  override async text(query: BookQuery, options?: TextOptions): Promise<BookText> {
    const slice = await this.readSlice(query.id ?? "", options);
    return { provider: Reader.key, title: "", authors: [], ...slice };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertBookQuery", () => {
  it("normalizes the ISBN it accepts", () => {
    expect(assertBookQuery({ isbn: "978-0-441-01359-3" }, "x").isbn).toBe("9780441013593");
  });

  it("rejects a query that identifies no book", () => {
    expect(() => assertBookQuery({}, "x")).toThrow(/needs one of isbn, id, or title/);
    expect(() => assertBookQuery({ author: "Herbert" }, "x")).toThrow(/author alone/);
    expect(() => assertBookQuery({ title: "  " }, "x")).toThrow(InvalidInputError);
  });
});

describe("assertHttpUrl", () => {
  it("accepts the schemes a catalog can serve a file over", () => {
    expect(assertHttpUrl("https://x.test/book.txt", "reader")).toBe("https://x.test/book.txt");
    expect(assertHttpUrl("http://x.test/book.txt", "reader")).toBe("http://x.test/book.txt");
  });

  it("refuses anything else, malformed URLs included", () => {
    expect(() => assertHttpUrl("file:///etc/passwd", "reader")).toThrow(InvalidInputError);
    expect(() => assertHttpUrl("not a url", "reader")).toThrow(InvalidInputError);
  });
});

describe("readSlice", () => {
  it("checks the file URL before fetching it", async () => {
    // The URL comes out of a provider's own response, so a catalog that started handing out
    // local paths would otherwise have this library read them.
    const fetch = stubRoutes({ "": { body: "", bytes: FAKE_TEXT_BYTES } });

    await expect(new Reader().text({ id: "file:///etc/passwd" })).rejects.toThrow(
      /refusing to read a file: URL/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clamps the caller's bounds to the shared ceiling", async () => {
    const fetch = stubRoutes({ "": { body: "", bytes: FAKE_TEXT_BYTES } });

    await new Reader().text(
      { id: "https://x.test/book.txt" },
      { offset: -5, maxBytes: 10_000_000 },
    );

    const range = new Headers(fetch.mock.calls[0]?.[1]?.headers).get("range");
    expect(range).toBe("bytes=0-262143");
  });
});
