/** Read on through one scan by chaining phrase searches, since a search returns a dozen words. */

import type { Provider } from "./provider.ts";
import type {
  TextDirection,
  TextFollowOptions,
  TextFollowResult,
  TextFollowStop,
  TextSearchOptions,
  TextSearchResult,
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

/** A passage split around one highlighted match, each part keeping its space next to the match. */
interface Split {
  readonly before: string;
  readonly after: string;
}

/**
 * Flatten OCR line breaks and runs of spaces, which are layout, not text.
 *
 * @param {string} text Passage text.
 * @returns {string} The text without match markers, on one line.
 */
function flatten(text: string): string {
  return text.replaceAll(/\{\{\{|\}\}\}/g, "").replaceAll(/\s+/g, " ");
}

/**
 * The words of `text` that a search can match, without the punctuation around them.
 *
 * @param {string} text Flattened passage text.
 * @returns {string[]} The words in order.
 */
function searchWords(text: string): string[] {
  return text
    .split(" ")
    .map((token) => token.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/**
 * Words compared case-insensitively, as the search index compares them.
 *
 * @param {string} text Flattened passage text.
 * @returns {string[]} The words in lower case.
 */
function keys(text: string): string[] {
  return searchWords(text).map((word) => word.toLowerCase());
}

/**
 * Split a passage around its last match reading forward, its first reading back.
 *
 * @param {string} snippet A passage with `{{{ }}}` around the match.
 * @param {TextDirection} direction Which way the chain reads.
 * @returns {Split | undefined} The text on either side, or `undefined` without a match.
 */
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
    before: flatten(snippet.slice(0, start)).trimStart(),
    after: flatten(snippet.slice(end + CLOSE.length)).trimEnd(),
  };
}

/**
 * How many words line up between two runs read outward from the anchor.
 *
 * @param {readonly string[]} left One run of words.
 * @param {readonly string[]} right The other run.
 * @returns {number} The length of the common prefix.
 */
function agreement(left: readonly string[], right: readonly string[]): number {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
  return count;
}

/** The words to search next, the words read before them nearest first, and the text to extend. */
interface Edge {
  readonly anchor: string;
  readonly context: readonly string[];
  readonly stem: string;
}

/**
 * A token holding no letter or digit, which no phrase search matches.
 *
 * @param {string} token A space-separated token.
 * @returns {boolean} Whether the token has nothing to search.
 */
function blank(token: string): boolean {
  return searchWords(token).length === 0;
}

/**
 * The passage's last words reading forward, its first reading back.
 *
 * The stem ends on the anchor's outer word, so punctuation past it and a line-end half word come
 * back once, with the next passage, instead of twice.
 *
 * @param {string} passage The text read so far.
 * @param {TextDirection} direction Which way the chain reads.
 * @param {number} size Words in the anchor.
 * @returns {Edge} The next anchor, its context, and the text to extend.
 */
function edgeOf(passage: string, direction: TextDirection, size: number): Edge {
  const tokens = passage.split(" ");
  if (direction === "backward") {
    const first = tokens.findIndex((token) => !blank(token));
    const head = (tokens[first] ?? "").replace(/^[^\p{L}\p{N}]+/u, "");
    const stem = [head, ...tokens.slice(first + 1)].join(" ");
    const words = searchWords(stem);
    return {
      anchor: words.slice(0, size).join(" "),
      context: words.slice(size).map((word) => word.toLowerCase()),
      stem,
    };
  }
  let last = tokens.findLastIndex((token) => !blank(token));
  if (tokens[last]?.endsWith("-"))
    last = tokens.findLastIndex((token, i) => i < last && !blank(token));
  const tail = (tokens[last] ?? "").replace(/[^\p{L}\p{N}]+$/u, "");
  const stem = [...tokens.slice(0, Math.max(0, last)), tail].join(" ");
  const words = searchWords(stem);
  const start = Math.max(0, words.length - size);
  return {
    anchor: words.slice(start).join(" "),
    context: words
      .slice(0, start)
      .map((word) => word.toLowerCase())
      .reverse(),
    stem,
  };
}

/**
 * New words from the passage whose context agrees with the text read so far, best first.
 *
 * A book can repeat the anchor (a recipe, a running header). A passage that disagrees on the
 * first word next to it sits elsewhere in the book, and stitching it on would invent text.
 *
 * @param {readonly string[]} snippets Passages from one step's hits on the book.
 * @param {Edge} edge The edge the step searched from.
 * @param {TextDirection} direction Which way the chain reads.
 * @returns {string | undefined} The new words, or `undefined` when no passage agrees.
 */
function continuation(
  snippets: readonly string[],
  edge: Edge,
  direction: TextDirection,
): string | undefined {
  let best: { words: string; score: number } | undefined;
  for (const snippet of snippets) {
    const split = splitPassage(snippet, direction);
    const score = split ? agreementWith(split, edge, direction) : undefined;
    if (split && score !== undefined && (!best || score > best.score)) {
      best = { words: direction === "forward" ? split.after : split.before, score };
    }
  }
  return best?.words;
}

/**
 * How well a passage agrees with the text read so far, next to the anchor.
 *
 * @param {Split} split The passage around its match.
 * @param {Edge} edge The edge the step searched from.
 * @param {TextDirection} direction Which way the chain reads.
 * @returns {number | undefined} Words that agree, or `undefined` when the first one disagrees.
 */
function agreementWith(split: Split, edge: Edge, direction: TextDirection): number | undefined {
  const outward = direction === "forward" ? keys(split.before).reverse() : keys(split.after);
  const score = agreement(outward, edge.context);
  return score === 0 && outward.length > 0 && edge.context.length > 0 ? undefined : score;
}

/**
 * A caller's number rounded into `[min, max]`.
 *
 * @param {number | undefined} value The number the caller passed.
 * @param {number} fallback Value for a missing, `NaN` or infinite number.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number} The bounded whole number.
 */
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(min, Math.round(value)), max);
}

/** A provider's `searchText`, bound. */
type Search = (query: string, options?: TextSearchOptions) => Promise<TextSearchResult>;

/** What one call reads with, from the caller's options. */
interface Settings {
  readonly book: string;
  readonly direction: TextDirection;
  readonly steps: number;
  readonly anchorWords: number;
  readonly maxPages: number;
  readonly searchOptions: Readonly<TextSearchOptions>;
}

/**
 * Validate the caller's options and bound the numbers in them.
 *
 * @param {TextFollowOptions} options The caller's options.
 * @param {string} provider Provider named in the error.
 * @returns {Settings} The settings the chain reads with.
 * @throws {InvalidInputError} When `book` is empty.
 */
function settingsOf(options: TextFollowOptions, provider: string): Settings {
  const book = options.book.trim();
  if (!book) {
    throw new InvalidInputError("book is empty: pass a scan id from a text search", provider);
  }
  const maxPages = bounded(options.maxPages, DEFAULT_STEP_PAGES, 1, MAX_TEXT_SEARCH_PAGES);
  return {
    book,
    direction: options.direction ?? "forward",
    steps: bounded(options.steps, DEFAULT_FOLLOW_STEPS, 1, MAX_FOLLOW_STEPS),
    anchorWords: bounded(
      options.anchorWords,
      DEFAULT_ANCHOR_WORDS,
      MIN_ANCHOR_WORDS,
      MAX_ANCHOR_WORDS,
    ),
    maxPages,
    searchOptions: { book, limit: STEP_LIMIT, maxPages },
  };
}

/** How one step ended: the passage it read to, a reason to stop, or both. */
interface Step {
  readonly passage?: string;
  readonly stop?: TextFollowStop;
  readonly error?: string;
}

/**
 * Append the words a step found to the text read so far.
 *
 * @param {Edge} edge The edge the step searched from.
 * @param {string | undefined} words The words that continue it.
 * @param {TextDirection} direction Which way the chain reads.
 * @returns {Step} The longer passage, or why the chain stops.
 */
function extend(edge: Edge, words: string | undefined, direction: TextDirection): Step {
  if (words === undefined) return { stop: "lost" };
  if (!words.trim()) return { stop: "end" };
  const passage = direction === "forward" ? `${edge.stem}${words}` : `${words}${edge.stem}`;
  return blank(words) ? { passage, stop: "end" } : { passage };
}

/**
 * Search once from the edge of the passage and read on.
 *
 * @param {Search} search The provider's text search.
 * @param {Edge} edge Where to search from.
 * @param {Settings} settings What the chain reads with.
 * @param {string} provider Provider named in a failure.
 * @returns {Promise<Step>} The longer passage, or why the chain stops.
 */
async function step(
  search: Search,
  edge: Edge,
  settings: Settings,
  provider: string,
): Promise<Step> {
  let snippets: string[];
  try {
    snippets = (await search(edge.anchor, settings.searchOptions)).matches[0]?.snippets ?? [];
  } catch (cause) {
    return { stop: "error", error: normalizeError(cause, provider).message };
  }
  return extend(edge, continuation(snippets, edge, settings.direction), settings.direction);
}

/** Where a chain stopped: the text read, the searches it took, and why. */
interface Chain {
  readonly passage: string;
  readonly searches: number;
  readonly stop: TextFollowStop;
  readonly error?: string;
}

/**
 * Chain searches from the opening passage until a step stops it or the steps run out.
 *
 * @param {Search} search The provider's text search.
 * @param {string} opening The passage the first search found.
 * @param {Settings} settings What the chain reads with.
 * @param {string} provider Provider named in a failure.
 * @returns {Promise<Chain>} The text read and why the chain stopped.
 */
async function readOn(
  search: Search,
  opening: string,
  settings: Settings,
  provider: string,
): Promise<Chain> {
  const { direction, anchorWords } = settings;
  const seen = new Set<string>();
  let passage = opening;
  for (let searches = 1; searches < settings.steps;) {
    const edge = edgeOf(passage, direction, anchorWords);
    const position = [edge.anchor.toLowerCase(), ...edge.context.slice(0, anchorWords)].join(" ");
    if (seen.has(position)) return { passage, searches, stop: "repeat" };
    seen.add(position);

    const next = await step(search, edge, settings, provider);
    searches += 1;
    passage = next.passage ?? passage;
    if (next.stop) return { passage, searches, stop: next.stop, error: next.error };
  }
  return { passage, searches: settings.steps, stop: "steps" };
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
 *
 * @param {Provider} provider A provider that serves `searchText`.
 * @param {string} query The phrase to start from.
 * @param {TextFollowOptions} options The scan to read, the direction, and the step budget.
 * @returns {Promise<TextFollowResult>} The text read, why it stopped, and the anchor to read on.
 * @throws {NotFoundError} When the first search doesn't find the phrase in that scan.
 */
export async function followText(
  provider: Provider,
  query: string,
  options: TextFollowOptions,
): Promise<TextFollowResult> {
  assertQuery(query, provider.name);
  const search = requireOperation(provider, "searchText");
  const settings = settingsOf(options, provider.name);
  const { book, direction, anchorWords } = settings;

  const phrase = query.trim();
  const first = await search(phrase, settings.searchOptions);
  const found = first.matches[0];
  const opening = found?.snippets.find((snippet) => splitPassage(snippet, direction));
  if (!found || opening === undefined) {
    throw new NotFoundError(
      `"${phrase}" in ${book} within ${settings.maxPages} page(s) of hits; a rarer phrase from the book ranks it higher`,
      provider.name,
    );
  }

  const chain = await readOn(search, flatten(opening).trim(), settings, provider.name);
  return {
    provider: first.provider,
    book,
    title: found.title,
    authors: found.authors,
    query: phrase,
    direction,
    ...chain,
    anchor: edgeOf(chain.passage, direction, anchorWords).anchor,
    url: found.url,
    attribution: first.attribution,
  };
}
