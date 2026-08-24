import { describe, expect, it } from "vitest";
import {
  formatBook,
  formatBookLine,
  formatBooks,
  formatFallback,
  formatProviders,
  formatRating,
  formatSearchAll,
  formatText,
} from "../../src/core/format.ts";
import { NotFoundError } from "../../src/core/errors.ts";
import { listProviders } from "../../src/core/registry.ts";
import type { Book, BookText } from "../../src/core/types.ts";
import "../../src/providers/index.ts";

const BOOK: Book = {
  provider: "openlibrary",
  title: "Placeholder Novel",
  subtitle: "a placeholder",
  authors: ["Placeholder Herbert"],
  year: 2005,
  published: "August 2, 2005",
  publisher: "Placeholder Press",
  isbn13: "9780441013593",
  pages: 544,
  languages: ["eng"],
  subjects: ["Science fiction"],
  description: "A blurb.",
  rating: { average: 4.302, scale: 5, count: 443 },
  id: "OL7524304M",
  url: "https://openlibrary.org/books/OL7524304M",
  attribution: "Catalog data from Open Library",
};

const TEXT: BookText = {
  provider: "gutendex",
  title: "Placeholder Gothic Novel",
  authors: ["Placeholder, Mary"],
  text: "Rozdział",
  offset: 0,
  bytes: 9,
  totalBytes: 448_885,
  truncated: true,
  nextOffset: 9,
  url: "https://www.gutenberg.org/ebooks/84.txt.utf-8",
  attribution: "Public-domain text from Project Gutenberg",
};

describe("formatRating", () => {
  it("prints the scale, because 8.2 means different things out of 5 and out of 10", () => {
    expect(formatRating({ average: 4.302, scale: 5, count: 443 })).toBe("4.3/5 from 443 ratings");
    expect(formatRating({ average: 8, scale: 10 })).toBe("8/10");
  });
});

describe("formatBookLine", () => {
  it("carries the id a follow-up lookup needs", () => {
    const line = formatBookLine({
      title: "Placeholder Novel",
      authors: ["Placeholder Herbert"],
      year: 1965,
      id: "OL893414W",
      isbn: "9780441013593",
    });
    expect(line).toBe(
      "Placeholder Novel - Placeholder Herbert  (1965, ISBN 9780441013593, id=OL893414W)",
    );
  });

  it("names the gap rather than printing an empty author", () => {
    expect(formatBookLine({ title: "Anonymous Work", authors: [] })).toBe(
      "Anonymous Work - unknown author",
    );
  });
});

describe("formatBooks", () => {
  it("says plainly when a catalog has nothing", () => {
    expect(formatBooks("bn", "nothing", [])).toBe('[bn] No matches for "nothing"');
  });
});

describe("formatBook", () => {
  it("ends with the source, so a record is never quoted without its catalog", () => {
    const rendered = formatBook(BOOK);
    expect(rendered).toContain("[openlibrary] Placeholder Novel: a placeholder");
    expect(rendered).toContain("ISBN-13: 9780441013593");
    expect(rendered).toContain("Rating: 4.3/5 from 443 ratings");
    expect(rendered.trimEnd().endsWith("Catalog data from Open Library")).toBe(true);
    expect(rendered).toContain("Source: https://openlibrary.org/books/OL7524304M");
  });

  it("omits fields the catalog did not fill in", () => {
    const rendered = formatBook({
      provider: "gutendex",
      title: "Placeholder",
      authors: [],
      languages: [],
      subjects: [],
    });
    expect(rendered).not.toContain("ISBN");
    expect(rendered).not.toContain("Rating");
  });
});

describe("formatText", () => {
  it("shows the byte window and how to read on", () => {
    const rendered = formatText(TEXT);
    expect(rendered).toContain("Bytes 0-9 of 448885");
    expect(rendered).toContain("(continues - read on from 9)");
  });

  it("says nothing about continuing once the end is reached", () => {
    expect(formatText({ ...TEXT, truncated: false, nextOffset: undefined })).not.toContain(
      "continues",
    );
  });
});

describe("formatFallback", () => {
  it("prefixes the result with the providers that were passed over", () => {
    const rendered = formatFallback(
      { provider: "bn", result: BOOK, skipped: [{ provider: "openlibrary", error: "Not found" }] },
      formatBook,
    );
    expect(rendered.startsWith("[openlibrary] skipped: Not found")).toBe(true);
  });
});

describe("formatSearchAll", () => {
  it("keeps a failed provider in the comparison", () => {
    const rendered = formatSearchAll("q", [
      { provider: "bn", error: new NotFoundError("nothing", "bn") },
      { provider: "gutendex", result: [] },
    ]);
    expect(rendered).toContain("[bn] error: Not found: nothing");
    expect(rendered).toContain('[gutendex] No matches for "q"');
  });
});

describe("formatProviders", () => {
  it("lists every registered provider with what it serves", () => {
    const rendered = formatProviders(listProviders());
    expect(rendered).toContain("Registered providers (5)");
    expect(rendered).toContain("gutendex: search, book, text");
    expect(rendered).toContain("openlibrary: search, book, isbn, ratings");
  });
});
