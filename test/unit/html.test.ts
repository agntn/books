import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/core/errors.ts";
import {
  jsonLd,
  ldNames,
  ldString,
  metaContent,
  parseHtml,
  requireJsonLd,
  selectAttribute,
  selectText,
} from "../../src/core/html.ts";

const PAGE = `<html><head>
<meta property="og:title" content="Placeholder Novel" />
<meta property="books:isbn" content="9780441013593" />
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Organization","name":"Site"}</script>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Book","name":"Placeholder Novel","isbn":"9780441013593","numberOfPages":"777","author":{"@type":"Person","name":"Placeholder Herbert"},"genre":"https://example.test/ksiazki/k/41/fantasy-science-fiction"}</script>
</head><body><div id="book-description">A blurb<br>on two lines</div></body></html>`;

describe("parseHtml", () => {
  it("keeps line structure by substituting <br> before parsing", () => {
    const text = parseHtml("<p>one<br>two</p>").querySelector("p")?.text;
    expect(text).toBe("one\ntwo");
  });
});

describe("selectors", () => {
  it("reads text and attributes, answering undefined when nothing matches", () => {
    const root = parseHtml(PAGE);
    expect(selectText(root, "#book-description")).toBe("A blurb on two lines");
    expect(selectText(root, "#missing")).toBeUndefined();
    expect(selectAttribute(root, 'meta[property="og:title"]', "content")).toBe("Placeholder Novel");
    expect(metaContent(root, "books:isbn")).toBe("9780441013593");
    expect(metaContent(root, "books:rating:value")).toBeUndefined();
  });
});

describe("jsonLd", () => {
  it("finds the wanted node among the several a page carries", () => {
    const node = jsonLd(parseHtml(PAGE), "Book");
    expect(ldString(node, "name")).toBe("Placeholder Novel");
    expect(ldString(node, "numberOfPages")).toBe("777");
    expect(ldNames(node, "author")).toEqual(["Placeholder Herbert"]);
  });

  it("walks arrays and @graph wrappers", () => {
    const page = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},[{"@type":"Book","name":"Nested"}]]}</script>`;
    expect(ldString(jsonLd(parseHtml(page), "Book"), "name")).toBe("Nested");
  });

  it("reads a number written where a string was expected", () => {
    const page = `<script type="application/ld+json">{"@type":"Book","numberOfPages":320}</script>`;
    expect(ldString(jsonLd(parseHtml(page), "Book"), "numberOfPages")).toBe("320");
  });

  it("salvages a node whose reviews carry an unescaped quote", () => {
    // This is the live shape of the Lubimyczytać page for Dune: a reader review opens with a
    // quoted title, which makes JSON.parse fail on the block as a whole.
    const page = `<script type="application/ld+json">{"@type":"Book","name":"Diuna","isbn":"9788381884105","review":[{"reviewBody":""Diuna" jest dobra"}]}</script>`;
    const node = jsonLd(parseHtml(page), "Book");
    expect(ldString(node, "name")).toBe("Diuna");
    expect(ldString(node, "isbn")).toBe("9788381884105");
    expect(node?.["review"]).toBeUndefined();
  });

  it("ignores a block that is broken beyond the reviews", () => {
    const page = `<script type="application/ld+json">{"@type":"Book" oops}</script>`;
    expect(jsonLd(parseHtml(page), "Book")).toBeUndefined();
  });
});

describe("ldNames", () => {
  it("accepts a node, a list, or a bare string", () => {
    const node = {
      "@type": "Book",
      author: [{ name: "One" }, "Two", { nothing: true }],
      genre: "Fantasy",
    };
    expect(ldNames(node, "author")).toEqual(["One", "Two"]);
    expect(ldNames(node, "genre")).toEqual(["Fantasy"]);
    expect(ldNames(node, "missing")).toEqual([]);
  });
});

describe("requireJsonLd", () => {
  it("raises a ParseError naming the page when the node is gone", () => {
    expect(() => requireJsonLd(parseHtml("<html></html>"), "Book", "lubimyczytac", "u")).toThrow(
      ParseError,
    );
  });
});
