/**
 * Lubimyczytać provider - the Polish reader community, for books in print
 *
 * No API: both operations read the site's HTML. A book page publishes a schema.org `Book` node
 * for search engines, and that node - not the class names around it - is what this provider
 * reads. Its distinguishing feature is the reader score, which no other provider here has for
 * contemporary Polish editions.
 *
 * Site: https://lubimyczytac.pl
 */

import type {
  Book,
  BookMatch,
  BookQuery,
  ProviderCapabilities,
  ProviderConfig,
  Rating,
  SearchOptions,
} from "../core/types.ts";
import { Provider, assertBookQuery, assertQuery, searchTerms } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { InvalidInputError, NotFoundError, UnsupportedOperationError } from "../core/errors.ts";
import { toIsbn13 } from "../core/isbn.ts";
import { jsonLd, ldNames, ldString, parseHtml, requireJsonLd, selectText } from "../core/html.ts";
import type { JsonLdNode } from "../core/html.ts";
import { register } from "../core/registry.ts";
import { normalizeText, parseYear, uniqueStrings } from "../core/text.ts";
import { clampMaxResults, toRating } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://lubimyczytac.pl";

/** Search result cards, and the parts of one that survive a redesign in practice. */
const RESULT_SELECTOR = "div.book-card";
const RESULT_TITLE_SELECTOR = "a.book-card__title";
const RESULT_AUTHOR_SELECTOR = ".book-card__author a";
const RESULT_RATING_SELECTOR = ".rating__avarage";
const RESULT_RATING_TEXT_SELECTOR = ".rating__text";

/** The blurb is the one part of the record that is not in the JSON-LD node. */
const DESCRIPTION_SELECTOR = "#book-description";

/** A book id here is the site path segment pair, as `search()` returns it: `4942534/diuna`. */
const PATH_ID = /^\d+\/[a-z0-9-]+$/;

/** The site prints decimals the Polish way. */
function parseDecimal(value: string | undefined): number | undefined {
  const parsed = Number(value?.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `z 24419 ocen` - the count lives in the text next to the average. */
function parseCount(value: string | undefined): number | undefined {
  const digits = value?.replace(/\s/g, "").match(/(\d+)/)?.[1];
  return digits ? Number(digits) : undefined;
}

/** `https://lubimyczytac.pl/ksiazki/k/41/fantasy-science-fiction` names a category in its slug. */
function categoryFromUrl(url: string | undefined): string | undefined {
  const slug = url?.split("/").filter(Boolean).pop();
  return slug ? slug.replace(/-/g, " ") : undefined;
}

function readRating(node: JsonLdNode | undefined): Rating | undefined {
  const aggregate = node?.["aggregateRating"];
  if (typeof aggregate !== "object" || aggregate === null) return undefined;
  const rating = aggregate as JsonLdNode;
  return toRating(
    parseDecimal(ldString(rating, "ratingValue")),
    parseDecimal(ldString(rating, "bestRating")) ?? 10,
    parseCount(ldString(rating, "ratingCount")),
  );
}

class Lubimyczytac extends Provider {
  static readonly key = "lubimyczytac";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * What this backend serves.
   *
   * `isbn` is false because the site's search box matches titles and authors: handed a number it
   * answers with unrelated books rather than with nothing, which is worse than admitting it
   * cannot do this.
   */
  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      book: true,
      text: false,
      isbn: false,
      ratings: true,
    };
  }

  override async search(query: string, options?: SearchOptions): Promise<BookMatch[]> {
    assertQuery(query, Lubimyczytac.key);
    const url = `${this.baseUrl}/szukaj/ksiazki${buildQuery({ phrase: query.trim() })}`;
    const page = parseHtml(await this.getText(url));
    const limit = clampMaxResults(options?.limit, MAX_RESULTS);
    const matches: BookMatch[] = [];

    for (const card of page.querySelectorAll(RESULT_SELECTOR)) {
      const link = card.querySelector(RESULT_TITLE_SELECTOR);
      const href = link?.getAttribute("href");
      const id = href?.replace(/^\/ksiazka\//, "").replace(/\/$/, "");
      const title = link?.text.replace(/\s+/g, " ").trim();
      if (!id || !title || !PATH_ID.test(id)) continue;

      matches.push({
        title,
        authors: uniqueStrings(
          card.querySelectorAll(RESULT_AUTHOR_SELECTOR).map((author) => author.text.trim()),
        ),
        id,
        language: "polski",
        url: `${this.baseUrl}${href}`,
        rating: toRating(
          parseDecimal(selectText(card, RESULT_RATING_SELECTOR)),
          10,
          parseCount(selectText(card, RESULT_RATING_TEXT_SELECTOR)),
        ),
      });
      if (matches.length >= limit) break;
    }

    return matches;
  }

  async book(query: BookQuery): Promise<Book> {
    const checked = assertBookQuery(query, Lubimyczytac.key);
    const id = checked.id?.trim() ?? (await this.searchId(checked));
    if (!PATH_ID.test(id)) {
      throw new InvalidInputError(
        `id must be an "<number>/<slug>" site path, got "${checked.id}"`,
        Lubimyczytac.key,
      );
    }

    const url = `${this.baseUrl}/ksiazka/${id}`;
    const page = parseHtml(await this.getText(url));
    const node = requireJsonLd(page, "Book", Lubimyczytac.key, url);
    const series = jsonLd(page, "BookSeries") ?? node["isPartOfSeries"];
    const seriesNode =
      typeof series === "object" && series !== null ? (series as JsonLdNode) : undefined;
    const seriesName = ldString(seriesNode, "name");
    const seriesPosition = ldString(seriesNode, "position");
    const published = ldString(node, "datePublished");
    const description = selectText(page, DESCRIPTION_SELECTOR);

    return {
      provider: Lubimyczytac.key,
      title: ldString(node, "name") ?? "",
      authors: ldNames(node, "author"),
      year: parseYear(published),
      published,
      isbn13: toIsbn13(ldString(node, "isbn")),
      pages: parseCount(ldString(node, "numberOfPages")),
      languages: uniqueStrings([ldString(node, "inLanguage")]),
      subjects: uniqueStrings([categoryFromUrl(ldString(node, "genre"))]),
      series: seriesName
        ? seriesPosition
          ? `${seriesName} (${seriesPosition})`
          : seriesName
        : undefined,
      description: description ? normalizeText(description) : undefined,
      cover: ldString(node, "image"),
      rating: readRating(node),
      id,
      url: ldString(node, "url") ?? url,
      attribution: "Book data and reader ratings from Lubimyczytać.pl",
    };
  }

  /** First search hit for a title query, since a book page can only be reached by its path. */
  private async searchId(query: BookQuery): Promise<string> {
    if (!query.title) {
      throw new UnsupportedOperationError("isbn", Lubimyczytac.key);
    }
    const search = searchTerms(query);
    const [match] = await this.search(search, { limit: 1 });
    if (!match?.id) {
      throw new NotFoundError(search, Lubimyczytac.key);
    }
    return match.id;
  }
}

register(Lubimyczytac, DEFAULT_BASE_URL);
