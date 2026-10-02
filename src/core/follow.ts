/** Read on through one scan by chaining phrase searches, since a search returns a dozen words. */

import type { Provider } from "./provider.ts";
import type {
  TextDirection,
  TextFollowOptions,
  TextFollowResult,
  TextFollowStop,
} from "./types.ts";
import { InvalidInputError, NotFoundError, normalizeError } from "./errors.ts";
import { assertQuery, requireOperation } from "./provider.ts";
import {
  DEFAULT_ANCHOR_WORDS,
  DEFAULT_FOLLOW_STEPS,
  MAX_ANCHOR_WORDS,
  MAX_FOLLOW_STEPS,
  MAX_TEXT_SEARCH_PAGES,
  MIN_ANCHOR_WORDS,
} from "./types.ts";

/** Hits on one page of a step: the most a text search serves, so the book ranks inside it. */
const STEP_LIMIT = 100;

/** Pages of hits a step reads by default; one page can take half a minute. */
const DEFAULT_STEP_PAGES = 1;

/** Markers the search puts around a match. */
const OPEN = "{{{";
const CLOSE = "}}}";

/** A passage split around one highlighted match, markers removed from both parts. */
interface Split {
  before: string;
  after: string;
}

/** Collapse OCR line breaks and runs of spaces, which are layout, not text. */
function collapse(text: string): string {
  return text
    .replaceAll(/\{\{\{|\}\}\}/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** The words of `text` that a search can match, without the punctuation around them. */
function searchWords(text: string): string[] {
  return text
    .split(" ")
    .map((token) => token.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** Words compared case-insensitively, as the search index compares them. */
function keys(text: string): string[] {
  return searchWords(text).map((word) => word.toLowerCase());
}

/** Split a passage around its last match reading forward, its first reading back. */
function splitPassage(snippet: string, direction: TextDirection): Split | undefined {
  let start: number;
  let end: number;
  if (direction === "forward") {
    end = snippet.lastIndexOf(CLOSE);
    start = end < 0 ? -1 : snippet.lastIndexOf(OPEN, end);
  } else {
    start = snippet.indexOf(OPEN);
    end = start < 0 ? -1 : snippet.indexOf(CLOSE, start + OPEN.length);
  }
  if (start < 0 || end < 0) return undefined;
  return {
    before: collapse(snippet.slice(0, start)),
    after: collapse(snippet.slice(end + CLOSE.length)),
  };
}

/** How many words line up between two runs read outward from the anchor. */
function agreement(left: string[], right: string[]): number {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
  return count;
}

/** The words to search next, and the words read before them, nearest first. */
interface Edge {
  anchor: string;
  context: string[];
}

/** The passage's last words reading forward, its first reading back; a line-end half word is out. */
function edgeOf(passage: string, direction: TextDirection, size: number): Edge {
  const words = searchWords(passage);
  if (direction === "backward") {
    return {
      anchor: words.slice(0, size).join(" "),
      context: words.slice(size).map((word) => word.toLowerCase()),
    };
  }
  const end = passage.endsWith("-") ? words.length - 1 : words.length;
  const start = Math.max(0, end - size);
  return {
    anchor: words.slice(start, end).join(" "),
    context: words
      .slice(0, start)
      .map((word) => word.toLowerCase())
      .reverse(),
  };
}

/**
 * New words from the passage whose context agrees with the text read so far, best first.
 *
 * A book can repeat the anchor (a recipe, a running header). A passage that disagrees on the
 * first word next to it sits elsewhere in the book, and stitching it on would invent text.
 */
function continuation(
  snippets: string[],
  edge: Edge,
  direction: TextDirection,
): string | undefined {
  let best: { words: string; score: number } | undefined;
  for (const snippet of snippets) {
    const split = splitPassage(snippet, direction);
    if (!split) continue;
    const outward = direction === "forward" ? keys(split.before).reverse() : keys(split.after);
    const score = agreement(outward, edge.context);
    if (score === 0 && outward.length > 0 && edge.context.length > 0) continue;
    if (!best || score > best.score) {
      best = { words: direction === "forward" ? split.after : split.before, score };
    }
  }
  return best?.words;
}

/** A caller's number rounded into `[min, max]`, or `fallback` when missing, `NaN` or infinite. */
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(min, Math.round(value)), max);
}

/**
 * Read on from a phrase inside one scan by searching again from the edge of each passage.
 *
 * A text search answers with about a dozen words around the phrase. Searching again from the last
 * words of that passage (or the first, reading back) returns the next dozen, so a chain of
 * searches reads a page. Each step can take half a minute on Open Library, so a call runs a few
 * steps and returns `anchor`, the query that reads on from where it stopped.
 *
 * The chain stops when the book drops out of a step's hits instead of paging through the whole
 * corpus: that happens when it drifts into a caption or a quotation many books share, and a phrase
 * from the main text further along (or a chain read backward from it) gets past the spot.
 *
 * @example
 *   ```ts
 *   import { create, followText } from "@agntn/books";
 *
 *   const read = await followText(create("openlibrary"), "the spice must flow", {
 *     book: "dunehousecorrino0000herb",
 *   });
 *   console.log(read.passage, read.anchor);
 *   ```
 */
export async function followText(
  provider: Provider,
  query: string,
  options: TextFollowOptions,
): Promise<TextFollowResult> {
  assertQuery(query, provider.name);
  const search = requireOperation(provider, "searchText");
  const book = options.book.trim();
  if (!book) {
    throw new InvalidInputError("book is empty: pass a scan id from a text search", provider.name);
  }

  const direction = options.direction ?? "forward";
  const steps = bounded(options.steps, DEFAULT_FOLLOW_STEPS, 1, MAX_FOLLOW_STEPS);
  const anchorWords = bounded(
    options.anchorWords,
    DEFAULT_ANCHOR_WORDS,
    MIN_ANCHOR_WORDS,
    MAX_ANCHOR_WORDS,
  );
  const maxPages = bounded(options.maxPages, DEFAULT_STEP_PAGES, 1, MAX_TEXT_SEARCH_PAGES);
  const searchOptions = { book, limit: STEP_LIMIT, maxPages };

  const phrase = query.trim();
  const first = await search(phrase, searchOptions);
  const found = first.matches[0];
  const opening = found?.snippets.find((snippet) => splitPassage(snippet, direction));
  if (!found || opening === undefined) {
    throw new NotFoundError(
      `"${phrase}" in ${book} within ${maxPages} page(s) of hits; a rarer phrase from the book ranks it higher`,
      provider.name,
    );
  }

  let passage = collapse(opening);
  let searches = 1;
  let stop: TextFollowStop = "steps";
  let error: string | undefined;
  const seen = new Set<string>();

  while (searches < steps) {
    const edge = edgeOf(passage, direction, anchorWords);
    const position = [edge.anchor.toLowerCase(), ...edge.context.slice(0, anchorWords)].join(" ");
    if (seen.has(position)) {
      stop = "repeat";
      break;
    }
    seen.add(position);

    let snippets: string[];
    try {
      snippets = (await search(edge.anchor, searchOptions)).matches[0]?.snippets ?? [];
    } catch (cause) {
      searches += 1;
      stop = "error";
      error = normalizeError(cause, provider.name).message;
      break;
    }
    searches += 1;

    const words = continuation(snippets, edge, direction);
    if (words === undefined) {
      stop = "lost";
      break;
    }
    if (!words) {
      stop = "end";
      break;
    }
    passage = direction === "forward" ? `${passage} ${words}` : `${words} ${passage}`;
    if (searchWords(words).length === 0) {
      stop = "end";
      break;
    }
  }

  return {
    provider: first.provider,
    book,
    title: found.title,
    authors: found.authors,
    query: phrase,
    direction,
    passage,
    searches,
    stop,
    error,
    anchor: edgeOf(passage, direction, anchorWords).anchor,
    url: found.url,
    attribution: first.attribution,
  };
}
