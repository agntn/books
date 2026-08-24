import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { OPENLIBRARY_EDITION, OPENLIBRARY_WORK, stubRoutes } from "../helpers.ts";
import "../../src/providers/openlibrary.ts";

/** Search shape captured from a live `/search.json` response during the API audit. */
const SEARCH = {
  numFound: 2,
  docs: [
    {
      key: "/works/OL893414W",
      title: "Placeholder Novel",
      author_name: ["Placeholder Herbert"],
      first_publish_year: 1965,
      isbn: ["not-an-isbn", "0441013597"],
      language: ["eng"],
      ratings_average: 4.3,
      ratings_count: 442,
    },
    { key: "/works/OL893461W", title: "Placeholder Sequel", author_name: ["Placeholder Herbert"] },
  ],
};

const ROUTES = {
  "/search.json": { body: SEARCH },
  "/isbn/": { body: OPENLIBRARY_EDITION },
  "/books/OL7524304M.json": { body: OPENLIBRARY_EDITION },
  "/works/OL893414W/ratings.json": { body: { summary: { average: 4.302, count: 443 } } },
  "/works/OL893414W.json": { body: OPENLIBRARY_WORK },
  "/authors/OL79034A.json": { body: { name: "Placeholder Herbert" } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openlibrary provider", () => {
  it("serves search, records, ISBN lookups and ratings, but no texts", () => {
    expect(create("openlibrary").capabilities).toEqual({
      search: true,
      book: true,
      text: false,
      isbn: true,
      ratings: true,
    });
  });

  it("maps search results and keeps only ISBNs that check out", async () => {
    const fetch = stubRoutes(ROUTES);

    const matches = await create("openlibrary").search!("placeholder", { limit: 2 });

    expect(String(fetch.mock.calls[0]?.[0])).toContain("fields=key%2Ctitle");
    expect(matches[0]).toMatchObject({
      title: "Placeholder Novel",
      authors: ["Placeholder Herbert"],
      year: 1965,
      id: "OL893414W",
      isbn: "9780441013593",
      url: "https://openlibrary.org/works/OL893414W",
      rating: { average: 4.3, scale: 5, count: 442 },
    });
    expect(matches[1]?.rating).toBeUndefined();
  });

  it("stitches an edition, its work, its ratings and its authors into one record", async () => {
    stubRoutes(ROUTES);

    const book = await create("openlibrary").book({ isbn: "978-0-441-01359-3" });

    expect(book).toMatchObject({
      provider: "openlibrary",
      title: "Placeholder Novel",
      authors: ["Placeholder Herbert"],
      year: 2005,
      publisher: "Placeholder Press",
      isbn13: "9780441013593",
      isbn10: "0441013597",
      pages: 544,
      languages: ["eng"],
      series: "Placeholder Series (1)",
      description: "A placeholder blurb for a placeholder novel.",
      rating: { average: 4.302, scale: 5, count: 443 },
      id: "OL7524304M",
    });
    expect(book.subjects).toContain("Science fiction");
    expect(book.cover).toBe("https://covers.openlibrary.org/b/id/14565843-L.jpg");
  });

  it("keeps the record when the work has no ratings", async () => {
    stubRoutes({
      ...ROUTES,
      "/works/OL893414W/ratings.json": { body: { summary: { average: null, count: 0 } } },
    });

    const book = await create("openlibrary").book({ isbn: "9780441013593" });

    expect(book.rating).toBeUndefined();
    expect(book.title).toBe("Placeholder Novel");
  });

  it("accepts a work key and a full path form of an id", async () => {
    stubRoutes(ROUTES);
    const provider = create("openlibrary");

    await expect(provider.book({ id: "OL893414W" })).resolves.toMatchObject({
      id: "OL893414W",
      description: "A placeholder blurb for a placeholder novel.",
    });
    await expect(provider.book({ id: "/works/OL893414W" })).resolves.toMatchObject({
      id: "OL893414W",
    });
  });

  it("refuses an id that is not an Open Library key", async () => {
    stubRoutes(ROUTES);
    await expect(create("openlibrary").book({ id: "84" })).rejects.toThrow(InvalidInputError);
  });

  it("reports a title nobody has as not found", async () => {
    stubRoutes({ ...ROUTES, "/search.json": { body: { numFound: 0, docs: [] } } });
    await expect(create("openlibrary").book({ title: "nothing here" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("validates the ISBN before sending a request", async () => {
    const fetch = stubRoutes(ROUTES);
    await expect(create("openlibrary").book({ isbn: "9780441013539" })).rejects.toThrow(
      InvalidInputError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
