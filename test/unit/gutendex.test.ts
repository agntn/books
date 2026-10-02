import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  InvalidInputError,
  NotFoundError,
  UnsupportedOperationError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { FAKE_TEXT_BYTES, GUTENDEX_BOOK, stubRoutes } from "../helpers.ts";
import "../../src/providers/gutendex.ts";

const ROUTES = {
  "/books/84": { body: GUTENDEX_BOOK },
  "/books/?search": { body: { count: 1, results: [GUTENDEX_BOOK] } },
  "84.txt.utf-8": { body: "", bytes: FAKE_TEXT_BYTES },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gutendex provider", () => {
  it("serves search, records and texts, but knows nothing of ISBNs", () => {
    expect(create("gutendex").capabilities).toEqual({
      search: true,
      book: true,
      text: true,
      searchText: false,
      isbn: false,
      ratings: false,
    });
  });

  it("requests the canonical search URL and preserves query text", async () => {
    const fetch = stubRoutes({
      "/books": { body: { count: 1, results: [GUTENDEX_BOOK, GUTENDEX_BOOK] } },
    });

    const matches = await create("gutendex").search!("title & author", { limit: 1 });

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://gutendex.com/books/?search=title+%26+author",
      expect.anything(),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("84");
  });

  it.each(["book", "text"] as const)(
    "requests the canonical detail URL for %s by id",
    async (operation) => {
      const fetch = stubRoutes(ROUTES);
      const provider = create("gutendex", { baseUrl: "https://catalog.test/api" });

      const result = await provider[operation]!({ id: "84" });

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "https://catalog.test/api/books/84/",
        expect.anything(),
      );
      expect(fetch).toHaveBeenCalledTimes(operation === "text" ? 2 : 1);
      expect(result.title).toBe("Placeholder Gothic Novel");
    },
  );

  it.each(["book", "text"] as const)(
    "requests the canonical search URL for %s by title",
    async (operation) => {
      const fetch = stubRoutes({
        ...ROUTES,
        "/books": { body: { count: 1, results: [GUTENDEX_BOOK] } },
      });

      const result = await create("gutendex")[operation]!({
        title: "placeholder",
        author: "Mary",
      });

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "https://gutendex.com/books/?search=placeholder+Mary",
        expect.anything(),
      );
      expect(fetch).toHaveBeenCalledTimes(operation === "text" ? 2 : 1);
      expect(result.title).toBe("Placeholder Gothic Novel");
    },
  );

  it("maps a catalog record, keeping every downloadable format", async () => {
    stubRoutes(ROUTES);

    const book = await create("gutendex").book({ id: "84" });

    expect(book).toMatchObject({
      provider: "gutendex",
      title: "Placeholder Gothic Novel",
      authors: ["Placeholder, Mary"],
      languages: ["en"],
      description: "A placeholder summary.",
      id: "84",
      url: "https://www.gutenberg.org/ebooks/84",
    });
    expect(book.subjects).toEqual(["Gothic fiction", "Category: Novels"]);
    expect(book.formats?.map((format) => format.type)).toContain("text/plain; charset=utf-8");
    // No publication year: a Gutenberg entry describes a text, not a printed edition.
    expect(book.year).toBeUndefined();
  });

  it("reads the UTF-8 plain-text rendering as a slice", async () => {
    stubRoutes(ROUTES);

    const text = await create("gutendex").text!({ title: "placeholder" }, { maxBytes: 8 });

    expect(text).toMatchObject({
      provider: "gutendex",
      title: "Placeholder Gothic Novel",
      offset: 0,
      truncated: true,
      url: "https://www.gutenberg.org/ebooks/84.txt.utf-8",
    });
    expect(text.text).toBe("Rozdzia");
    expect(text.attribution).toMatch(/Project Gutenberg/);
  });

  it("says so when a record has no plain-text rendering", async () => {
    stubRoutes({
      ...ROUTES,
      "/books/84": { body: { ...GUTENDEX_BOOK, formats: { "text/html": "https://x.test/84" } } },
    });

    await expect(create("gutendex").text!({ id: "84" })).rejects.toThrow(NotFoundError);
  });

  it("prefers a UTF-8 rendering over a bare text/plain one", async () => {
    stubRoutes({
      ...ROUTES,
      "/books/84": {
        body: {
          ...GUTENDEX_BOOK,
          formats: {
            "text/plain": "https://x.test/ascii.txt",
            "text/plain; charset=utf-8": "https://x.test/84.txt.utf-8",
          },
        },
      },
      "84.txt.utf-8": { body: "", bytes: FAKE_TEXT_BYTES },
    });

    const text = await create("gutendex").text!({ id: "84" });
    expect(text.url).toBe("https://x.test/84.txt.utf-8");
  });

  it("refuses an id that is not a Gutenberg book number", async () => {
    stubRoutes(ROUTES);
    await expect(create("gutendex").book({ id: "OL893414W" })).rejects.toThrow(InvalidInputError);
  });

  it("declines an ISBN lookup rather than searching for the number", async () => {
    const fetch = stubRoutes(ROUTES);
    await expect(create("gutendex").book({ isbn: "9780441013593" })).rejects.toThrow(
      UnsupportedOperationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
