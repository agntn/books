import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InvalidInputError, NotFoundError, ParseError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { OPENLIBRARY_EDITION, OPENLIBRARY_WORK, calledUrl, stubRoutes } from "../helpers.ts";
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
  it("serves search, records, ISBN lookups, ratings and passages, but no texts", () => {
    expect(create("openlibrary").capabilities).toEqual({
      search: true,
      book: true,
      text: false,
      searchText: true,
      isbn: true,
      ratings: true,
    });
  });

  it("maps search results and keeps only ISBNs that check out", async () => {
    const fetch = stubRoutes(ROUTES);

    const matches = await create("openlibrary").search!("placeholder", { limit: 2 });

    expect(calledUrl(fetch.mock.calls[0])).toContain("fields=key%2Ctitle");
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

  it("refuses a record key from the catalog that would climb the path", async () => {
    // `works[0].key` is data the catalog supplies and it lands between two slashes of the next
    // request; WHATWG resolves `..`, so an unchecked key sends the request somewhere else.
    const fetch = stubRoutes({
      ...ROUTES,
      "/isbn/": {
        body: { ...OPENLIBRARY_EDITION, works: [{ key: "/works/../../admin/secrets" }] },
      },
    });

    await expect(create("openlibrary").book({ isbn: "9780441013593" })).rejects.toThrow(ParseError);
    expect(fetch.mock.calls.some((call) => calledUrl(call).includes("admin"))).toBe(false);
  });

  it("keeps an edition's record when its work is missing", async () => {
    // The catalog is public-edited and does go inconsistent. The edition already carries the
    // title, ISBN and page count; reporting "not found" for it would also send a fallback walk
    // on to a lesser catalog.
    stubRoutes({
      ...ROUTES,
      "/works/OL893414W.json": { body: { error: "notfound" }, status: 404 },
    });

    const book = await create("openlibrary").book({ isbn: "9780441013593" });

    expect(book).toMatchObject({ title: "Placeholder Novel", pages: 544, isbn13: "9780441013593" });
    expect(book.description).toBeUndefined();
  });

  it("still fails when the work itself was the thing asked for", async () => {
    stubRoutes({
      ...ROUTES,
      "/works/OL893414W.json": { body: { error: "notfound" }, status: 404 },
    });
    await expect(create("openlibrary").book({ id: "OL893414W" })).rejects.toThrow(NotFoundError);
  });

  it("validates the ISBN before sending a request", async () => {
    const fetch = stubRoutes(ROUTES);
    await expect(create("openlibrary").book({ isbn: "9780441013539" })).rejects.toThrow(
      InvalidInputError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

/* One `/search/inside.json` hit in the live shape: one-element arrays and nested page numbers. */
function insideHit(identifier: string, snippet: string) {
  return {
    fields: {
      identifier: [identifier],
      meta_title: [`Placeholder ${identifier}`],
      meta_creator: ["Placeholder, Author"],
      meta_year: [1999],
      page_num: [[42]],
    },
    highlight: { text: [snippet] },
  };
}

function insidePage(total: number, ...hits: readonly unknown[]) {
  return { body: { hits: { total, hits } } };
}

describe("openlibrary searchText", () => {
  it("maps each hit to its scan, passages and reader link", async () => {
    const fetch = stubRoutes({
      "/search/inside.json": insidePage(
        45,
        insideHit("placeholderscan0000auth", "before {{{the made-up phrase}}}\nafter "),
      ),
    });

    const result = await create("openlibrary").searchText!(" the made-up phrase ");

    const url = new URL(calledUrl(fetch.mock.calls[0]));
    expect(url.pathname).toBe("/search/inside.json");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "the made-up phrase",
      page: "1",
      limit: "20",
    });
    expect(result).toMatchObject({
      provider: "openlibrary",
      query: "the made-up phrase",
      total: 45,
      page: 1,
      nextPage: 2,
    });
    expect(result.matches).toEqual([
      {
        id: "placeholderscan0000auth",
        title: "Placeholder placeholderscan0000auth",
        authors: ["Placeholder, Author"],
        year: 1999,
        page: 42,
        snippets: ["before {{{the made-up phrase}}}\nafter"],
        url: "https://archive.org/details/placeholderscan0000auth?q=%22the+made-up+phrase%22",
      },
    ]);
  });

  it("reads pages of 100 until the named book shows up, and keeps only its passages", async () => {
    const fetch = stubRoutes({
      "page=1&": insidePage(250, insideHit("otherscan", "{{{phrase}}} elsewhere")),
      "page=2&": insidePage(
        250,
        insideHit("otherscan", "{{{phrase}}} again"),
        insideHit("targetscan", "{{{phrase}}} here"),
      ),
    });

    const result = await create("openlibrary").searchText!("phrase", { book: "targetscan" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(calledUrl(fetch.mock.calls[1])).toContain("limit=100");
    expect(result.page).toBe(2);
    expect(result.nextPage).toBe(3);
    expect(result.matches.map((match) => match.id)).toEqual(["targetscan"]);
  });

  it("stops at maxPages and says where to read on", async () => {
    const fetch = stubRoutes({
      "/search/inside.json": insidePage(1000, insideHit("otherscan", "x")),
    });

    const result = await create("openlibrary").searchText!("phrase", {
      book: "targetscan",
      page: 4,
      maxPages: 2,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(calledUrl(fetch.mock.calls[1])).toContain("page=5&");
    expect(result).toMatchObject({ page: 5, nextPage: 6, matches: [] });
  });

  it("stops at the end of the corpus before maxPages run out", async () => {
    const fetch = stubRoutes({
      "/search/inside.json": insidePage(30, insideHit("otherscan", "x")),
    });

    const result = await create("openlibrary").searchText!("phrase", {
      book: "targetscan",
      maxPages: 5,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ page: 1, matches: [] });
    expect(result.nextPage).toBeUndefined();
  });

  it("reads a NaN page, limit or maxPages as absent instead of sending nothing", async () => {
    const fetch = stubRoutes({
      "/search/inside.json": insidePage(1000, insideHit("otherscan", "x")),
    });

    await create("openlibrary").searchText!("phrase", {
      book: "targetscan",
      page: Number.NaN,
      limit: Number.NaN,
      maxPages: Number.NaN,
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(calledUrl(fetch.mock.calls[0])).toContain("page=1&limit=100");
  });

  it("drops a hit whose identifier would leave the reader's path", async () => {
    stubRoutes({
      "/search/inside.json": insidePage(2, insideHit("../admin", "x"), insideHit("goodscan", "y")),
    });

    const result = await create("openlibrary").searchText!("phrase");

    expect(result.matches.map((match) => match.id)).toEqual(["goodscan"]);
  });

  it("refuses a malformed book id and an empty phrase before sending a request", async () => {
    const fetch = stubRoutes({});
    const provider = create("openlibrary");

    await expect(provider.searchText!("phrase", { book: "a b" })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(provider.searchText!("   ")).rejects.toThrow(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a response without hits as a parse failure, not as no matches", async () => {
    stubRoutes({ "/search/inside.json": { body: { error: "search unavailable" } } });

    await expect(create("openlibrary").searchText!("phrase")).rejects.toThrow(ParseError);
  });
});
