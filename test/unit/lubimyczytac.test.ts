import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InvalidInputError, ParseError, UnsupportedOperationError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { stubRoutes } from "../helpers.ts";
import "../../src/providers/lubimyczytac.ts";

/** Result card shape captured from `/szukaj/ksiazki?phrase=` during the API audit. */
const SEARCH_PAGE = `<html><body>
<div class="book-card book-card--l" data-book-id="4942534">
  <a class="book-card__title" href="/ksiazka/4942534/placeholder"> Placeholder Powieść </a>
  <div class="book-card__author"><a href="/autor/3481/placeholder-herbert">Placeholder Herbert</a></div>
  <div class="book-card__detail book-card__detail--rating"><div class="rating rating--book-list">
    <span class="rating__avarage">8,2</span><span class="rating__text"> &nbsp;<small>z</small> 24419 ocen </span>
  </div></div>
</div>
<div class="book-card book-card--l" data-book-id="4838618">
  <a class="book-card__title" href="/ksiazka/4838618/placeholder-audio"> Placeholder - audio </a>
  <div class="book-card__author"><a href="/autor/3481/placeholder-herbert">Placeholder Herbert</a></div>
  <div class="rating rating--book-list"><span class="rating__avarage">0</span><span class="rating__text"> z 0 ocen </span></div>
</div>
</body></html>`;

/** Book page: a schema.org node whose review list carries an unescaped quote, as the site does. */
const BOOK_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Organization","name":"Site"}</script>
<script type="application/ld+json">{"@context": "http://schema.org","@type": "Book","name":"Placeholder Powieść","isbn":"9788381884105","datePublished":"2024-01-01","url":"https://lubimyczytac.pl/ksiazka/4942534/placeholder","genre":"https://lubimyczytac.pl/ksiazki/k/41/fantasy-science-fiction","inLanguage":"polski","numberOfPages":"777","isPartOfSeries":{"@type":"BookSeries","name":"Cykl Placeholder","position":"1"},"image":"https://s.lubimyczytac.pl/upload/books/placeholder.jpg","author":{"@type":"Person","name":"Placeholder Herbert"},"aggregateRating":{"@type":"AggregateRating","worstRating":1,"bestRating":10,"ratingValue":"8,2","ratingCount":24419},"review":[{"@type":"Review","reviewBody":""Placeholder" jest dobra"}]}</script>
</head><body><div class="book__description" id="book-description"> Placeholder blurb. </div></body></html>`;

const ROUTES = {
  "/szukaj/ksiazki": { body: SEARCH_PAGE, html: true },
  "/ksiazka/4942534/placeholder": { body: BOOK_PAGE, html: true },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lubimyczytac provider", () => {
  it("serves search, records and ratings, but no texts and no ISBN lookups", () => {
    expect(create("lubimyczytac").capabilities).toEqual({
      search: true,
      book: true,
      text: false,
      searchText: false,
      isbn: false,
      ratings: true,
    });
  });

  it("reads matches off the result cards, ids included", async () => {
    stubRoutes(ROUTES);

    const matches = await create("lubimyczytac").search!("placeholder");

    expect(matches[0]).toMatchObject({
      title: "Placeholder Powieść",
      authors: ["Placeholder Herbert"],
      id: "4942534/placeholder",
      url: "https://lubimyczytac.pl/ksiazka/4942534/placeholder",
      rating: { average: 8.2, scale: 10, count: 24_419 },
    });
  });

  it("reports no rating rather than a zero for a book nobody has rated", async () => {
    stubRoutes(ROUTES);
    const matches = await create("lubimyczytac").search!("placeholder");
    expect(matches[1]?.rating).toBeUndefined();
  });

  it("maps a record out of the JSON-LD node despite its broken review list", async () => {
    stubRoutes(ROUTES);

    const book = await create("lubimyczytac").book({ id: "4942534/placeholder" });

    expect(book).toMatchObject({
      provider: "lubimyczytac",
      title: "Placeholder Powieść",
      authors: ["Placeholder Herbert"],
      year: 2024,
      published: "2024-01-01",
      isbn13: "9788381884105",
      pages: 777,
      languages: ["polski"],
      series: "Cykl Placeholder (1)",
      description: "Placeholder blurb.",
      rating: { average: 8.2, scale: 10, count: 24_419 },
      id: "4942534/placeholder",
    });
    expect(book.subjects).toEqual(["fantasy science fiction"]);
  });

  it("finds a book by title through its own search", async () => {
    stubRoutes(ROUTES);
    const book = await create("lubimyczytac").book({ title: "placeholder", author: "herbert" });
    expect(book.id).toBe("4942534/placeholder");
  });

  it("declines an ISBN lookup, which its search box answers with unrelated books", async () => {
    const fetch = stubRoutes(ROUTES);
    await expect(create("lubimyczytac").book({ isbn: "9788381884105" })).rejects.toThrow(
      UnsupportedOperationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a site path", async () => {
    stubRoutes(ROUTES);
    await expect(create("lubimyczytac").book({ id: "4942534" })).rejects.toThrow(InvalidInputError);
  });

  it("raises a ParseError when the page no longer carries the node", async () => {
    stubRoutes({
      ...ROUTES,
      "/ksiazka/4942534/placeholder": { body: "<html><body>redesign</body></html>", html: true },
    });

    await expect(create("lubimyczytac").book({ id: "4942534/placeholder" })).rejects.toThrow(
      ParseError,
    );
  });
});
