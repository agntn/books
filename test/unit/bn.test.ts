import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { stubRoutes } from "../helpers.ts";
import "../../src/providers/bn.ts";

/**
 * Record shape captured from a live `/api/institutions/bibs.json` response during the API audit.
 *
 * The flat fields are what the API concatenates out of MARC - note the author repeated with the
 * publisher glued into it, which is exactly why this provider reads the MARC instead.
 */
const RECORD = {
  id: 1_011_103,
  deleted: false,
  title: "Placeholder Powieść / Cykl t. 2",
  author: "Placeholder, Andrzej (1948- ) Wydawca Placeholder, Andrzej (1948- ).",
  publisher: 'Wydawca "WYDAWCA",',
  publicationYear: "1995",
  isbnIssn: "8370540910",
  language: "polski",
  languageOfOriginal: "polski",
  kind: "książka",
  formOfWork: "Książki Proza",
  marc: {
    leader: "02430nam a2200757 i 4500",
    fields: [
      { "001": "b0000001011103" },
      { "020": { ind1: " ", ind2: " ", subfields: [{ a: "8370540910" }] } },
      { "041": { ind1: " ", ind2: " ", subfields: [{ a: "pol" }] } },
      {
        "100": {
          ind1: "1",
          ind2: " ",
          subfields: [{ a: "Placeholder, Andrzej" }, { d: "(1948- )" }],
        },
      },
      {
        "245": {
          ind1: "1",
          ind2: "0",
          subfields: [
            { a: "Placeholder Powieść /" },
            { b: "opowieść o niczym :" },
            { c: "Andrzej Placeholder." },
          ],
        },
      },
      {
        "260": {
          ind1: " ",
          ind2: " ",
          subfields: [{ a: "Warszawa :" }, { b: '"WYDAWCA",' }, { c: "1995" }],
        },
      },
      { "300": { ind1: " ", ind2: " ", subfields: [{ a: "295 s. ;" }, { c: "20 cm." }] } },
      { "490": { ind1: "1", ind2: " ", subfields: [{ a: "Cykl Placeholder" }] } },
      { "520": { ind1: " ", ind2: " ", subfields: [{ a: "Placeholder annotation." }] } },
      { "650": { ind1: " ", ind2: "4", subfields: [{ a: "Potwory" }] } },
      { "655": { ind1: " ", ind2: "4", subfields: [{ a: "Fantasy" }] } },
      { "700": { ind1: "1", ind2: " ", subfields: [{ a: "Tłumacz, Jan," }] } },
    ],
  },
};

const ROUTES = { "bibs.json": { body: { bibs: [RECORD] } } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bn provider", () => {
  it("serves search, records and ISBN lookups, but no texts or ratings", () => {
    expect(create("bn").capabilities).toEqual({
      search: true,
      book: true,
      text: false,
      isbn: true,
      ratings: false,
    });
  });

  it("reads a record out of MARC rather than the concatenated flat fields", async () => {
    stubRoutes(ROUTES);

    const book = await create("bn").book({ isbn: "8370540910" });

    expect(book).toMatchObject({
      provider: "bn",
      title: "Placeholder Powieść",
      subtitle: "opowieść o niczym",
      // The flat `author` field repeats the name and glues the publisher in between.
      authors: ["Placeholder, Andrzej", "Tłumacz, Jan"],
      year: 1995,
      published: "1995",
      publisher: "WYDAWCA",
      isbn10: "8370540910",
      isbn13: "9788370540913",
      pages: 295,
      series: "Cykl Placeholder",
      description: "Placeholder annotation.",
      id: "1011103",
    });
    expect(book.languages).toEqual(["pol", "polski"]);
    expect(book.subjects).toEqual(["Potwory", "Fantasy", "Książki Proza"]);
  });

  it("never pairs the ISBN of one edition with the ISBN of another", async () => {
    // A record lists every identifier it knows - here the print run and an unrelated reissue.
    // Reporting both would present two editions as one book written two ways.
    stubRoutes({
      "bibs.json": {
        body: {
          bibs: [
            {
              ...RECORD,
              isbnIssn: "9788375780420 0705140911",
              marc: { fields: RECORD.marc.fields.filter((field) => !("020" in field)) },
            },
          ],
        },
      },
    });

    const book = await create("bn").book({ id: "1011103" });

    expect(book.isbn13).toBe("9788375780420");
    expect(book.isbn10).toBeUndefined();
  });

  it("reports both forms when they are the same number", async () => {
    stubRoutes(ROUTES);
    const book = await create("bn").book({ id: "1011103" });
    expect(book.isbn10).toBe("8370540910");
    expect(book.isbn13).toBe("9788370540913");
  });

  it("asks for an ISBN in both lengths, since the catalog matches what was typed", async () => {
    const fetch = stubRoutes(ROUTES);

    await create("bn").book({ isbn: "978-83-7054-091-3" });
    await create("bn").book({ isbn: "8370540910" });

    const [first, second] = fetch.mock.calls.map((call) => new URL(String(call[0])).searchParams);
    expect(first?.get("isbnIssn")).toBe("9788370540913 | 8370540910");
    expect(first?.get("boolean")).toBe("true");
    expect(second?.get("isbnIssn")).toBe("8370540910 | 9788370540913");
    expect(second?.get("boolean")).toBe("true");
  });

  it("sends a 979 number alone, since it has no ten-digit form", async () => {
    const fetch = stubRoutes(ROUTES);

    await create("bn").book({ isbn: "9791090636071" });

    const params = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
    expect(params.get("isbnIssn")).toBe("9791090636071");
    expect(params.has("boolean")).toBe(false);
  });

  it("sends only documented parameters, since the API ignores the rest", async () => {
    const fetch = stubRoutes(ROUTES);

    await create("bn").search!("placeholder", { limit: 3 });

    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain("title=placeholder");
    // Three wanted plus the margin that covers withdrawn records filtered out locally.
    expect(url).toContain("limit=8");
    expect(url).not.toContain("search=");
    expect(url).not.toContain("q=");
  });

  it("asks for more than the caller wants, because withdrawn records are dropped locally", async () => {
    // The catalog applies `limit` before this library filters `deleted`, so a bare limit returns
    // fewer records than asked for - and a single-record lookup that lands on a withdrawn entry
    // reports "not found" for a book the catalog holds.
    const withdrawn = { ...RECORD, id: 1, deleted: true };
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const limit = Number(new URL(String(input)).searchParams.get("limit") ?? 10);
      const bibs = [withdrawn, { ...RECORD, id: 2 }, { ...RECORD, id: 3 }].slice(0, limit);
      return new Response(JSON.stringify({ bibs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    expect(await create("bn").search!("placeholder", { limit: 2 })).toHaveLength(2);
    await expect(create("bn").book({ id: "1011103" })).resolves.toMatchObject({ id: "2" });
  });

  it("reads a subfield in linear time, whatever the catalog put in it", async () => {
    // `/\s*[/:;,=]$/` backtracked from every position of a long run of spaces: 50k spaces took
    // 1.5 s, and the field's length is the catalog's to decide, not this library's.
    stubRoutes({
      "bibs.json": {
        body: {
          bibs: [
            {
              ...RECORD,
              marc: {
                fields: [{ "245": { subfields: [{ a: `${" ".repeat(50_000)}Title /` }] } }],
              },
            },
          ],
        },
      },
    });

    const started = performance.now();
    const book = await create("bn").book({ id: "1011103" });
    expect(performance.now() - started).toBeLessThan(250);
    expect(book.title).toBe("Title");
  });

  it("retries a search as an author query when the title index has nothing", async () => {
    const fetch = stubRoutes({
      "title=": { body: { bibs: [] } },
      "author=": { body: { bibs: [RECORD] } },
    });

    const matches = await create("bn").search!("Placeholder");

    expect(String(fetch.mock.calls[0]?.[0])).toContain("title=Placeholder");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("author=Placeholder");
    expect(matches[0]?.title).toBe("Placeholder Powieść");
  });

  it("drops withdrawn records", async () => {
    stubRoutes({ "bibs.json": { body: { bibs: [{ ...RECORD, deleted: true }] } } });
    await expect(create("bn").book({ id: "1011103" })).rejects.toThrow(NotFoundError);
  });

  it("refuses an id that is not a numeric record id", async () => {
    stubRoutes(ROUTES);
    await expect(create("bn").book({ id: "OL893414W" })).rejects.toThrow(InvalidInputError);
  });
});
