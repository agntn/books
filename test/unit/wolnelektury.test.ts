import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { FAKE_TEXT_BYTES, WOLNELEKTURY_BOOK, stubRoutes } from "../helpers.ts";
import "../../src/providers/wolnelektury.ts";

/** Result page shape captured from `/szukaj/?q=` during the API audit. */
const SEARCH_PAGE = `<html><body><div class="l-books__grid">
<article class="l-books__item">
  <figure class="l-books__item__img"><a href="/katalog/lektura/placeholder/"><img alt="Placeholder Powieść"></a></figure>
  <h3 class="s"><a href="/katalog/autor/placeholder-prus/">Placeholder Prus</a></h3>
  <h2 class="s"><a href="/katalog/lektura/placeholder/">Placeholder Powieść</a></h2>
  <span class="other-info s">Epika Powieść Pozytywizm</span>
</article>
<article class="l-books__item">
  <h3 class="s"><a href="/katalog/autor/other/">Other Author</a></h3>
  <h2 class="s"><a href="/katalog/lektura/other/">Other Book</a></h2>
</article>
</div></body></html>`;

const ROUTES = {
  "/szukaj/": { body: SEARCH_PAGE, html: true },
  "/api/books/placeholder/": { body: WOLNELEKTURY_BOOK },
  "placeholder.txt": { body: "", bytes: FAKE_TEXT_BYTES },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wolnelektury provider", () => {
  it("serves search, records and texts, but knows nothing of ISBNs", () => {
    expect(create("wolnelektury").capabilities).toEqual({
      search: true,
      book: true,
      text: true,
      searchText: false,
      isbn: false,
      ratings: false,
    });
  });

  it("reads title, author and slug off the result page", async () => {
    stubRoutes(ROUTES);

    const matches = await create("wolnelektury").search!("placeholder", { limit: 1 });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      title: "Placeholder Powieść",
      authors: ["Placeholder Prus"],
      id: "placeholder",
      language: "pol",
      url: "https://wolnelektury.pl/katalog/lektura/placeholder/",
    });
  });

  it("maps a record and normalizes the digital edition's ISBN", async () => {
    stubRoutes(ROUTES);

    const book = await create("wolnelektury").book({ id: "placeholder" });

    expect(book).toMatchObject({
      provider: "wolnelektury",
      title: "Placeholder Powieść",
      authors: ["Placeholder Prus"],
      // The record prints it as "ISBN 978-83-288-3733-1".
      isbn13: "9788328837331",
      languages: ["pol"],
      id: "placeholder",
    });
    expect(book.subjects).toEqual(["Pozytywizm", "Powieść", "Epika"]);
    expect(book.formats?.map((format) => format.type)).toEqual([
      "text/plain; charset=utf-8",
      "application/epub+zip",
      "application/pdf",
    ]);
  });

  it("reads the text file as a slice, keeping Polish characters whole", async () => {
    stubRoutes(ROUTES);

    const text = await create("wolnelektury").text!({ id: "placeholder" }, { maxBytes: 9 });

    expect(text.text).toBe("Rozdział");
    expect(text.bytes).toBe(9);
    expect(text.nextOffset).toBe(9);
    expect(text.attribution).toMatch(/Wolne Lektury/);
  });

  it("points at the volumes when the record is a multi-volume shell", async () => {
    stubRoutes({
      ...ROUTES,
      "/api/books/placeholder/": {
        body: {
          ...WOLNELEKTURY_BOOK,
          txt: "",
          children: [{ slug: "placeholder-tom-pierwszy" }, { slug: "placeholder-tom-drugi" }],
        },
      },
    });

    await expect(create("wolnelektury").text!({ id: "placeholder" })).rejects.toThrow(
      /placeholder-tom-pierwszy, placeholder-tom-drugi/,
    );
  });

  it("refuses an id that is not a catalog slug", async () => {
    stubRoutes(ROUTES);
    await expect(create("wolnelektury").book({ id: "Nie Slug" })).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("reports a title the library does not have as not found", async () => {
    stubRoutes({ ...ROUTES, "/szukaj/": { body: "<html></html>", html: true } });
    await expect(create("wolnelektury").book({ title: "nothing" })).rejects.toThrow(NotFoundError);
  });
});
