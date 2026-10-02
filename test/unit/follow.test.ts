import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { followText } from "../../src/core/follow.ts";
import { formatTextFollow } from "../../src/core/format.ts";
import { create } from "../../src/core/registry.ts";
import { calledUrl, stubRoutes } from "../helpers.ts";
import "../../src/providers/openlibrary.ts";

const BOOK = "placeholderscan0000keep";

/* One page of `/search/inside.json` holding `id` with these passages. */
function hits(id: string, ...snippets: readonly string[]) {
  return {
    body: {
      hits: {
        total: 1,
        hits: [
          {
            fields: {
              identifier: [id],
              meta_title: ["The Placeholder Lighthouse"],
              meta_creator: ["Placeholder, Keeper"],
            },
            highlight: { text: snippets },
          },
        ],
      },
    },
  };
}

/* The route of one step, told apart by its phrase. */
function step(phrase: string): string {
  return `q=${phrase.replaceAll(" ", "+")}&page`;
}

/* Queries the stubbed endpoint was asked, in order. */
function queries(calls: readonly (readonly unknown[])[]): string[] {
  return calls.map((call) => new URL(calledUrl(call)).searchParams.get("q") ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("followText", () => {
  it("reads forward from the last words of each passage and stitches the new ones on", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "The lighthouse keeper {{{counted seven gulls}}} on the rail,\nbefore",
      ),
      [step("the rail before")]: hits(
        BOOK,
        "a sailor leaned over {{{the rail before}}} breakfast was served",
        "seven gulls on {{{the rail, before}}} the fog rolled over",
      ),
      [step("fog rolled over")]: hits(
        BOOK,
        "before the {{{fog rolled over}}} the harbour wall and",
      ),
    });

    const read = await followText(create("openlibrary"), " counted seven gulls ", {
      book: BOOK,
      anchorWords: 3,
    });

    expect(queries(fetch.mock.calls)).toEqual([
      "counted seven gulls",
      "the rail before",
      "fog rolled over",
    ]);
    expect(fetch.mock.calls.every((call) => calledUrl(call).includes("limit=100"))).toBe(true);
    expect(read).toMatchObject({
      provider: "openlibrary",
      book: BOOK,
      title: "The Placeholder Lighthouse",
      query: "counted seven gulls",
      direction: "forward",
      passage:
        "The lighthouse keeper counted seven gulls on the rail, before the fog rolled over the harbour wall and",
      searches: 3,
      stop: "steps",
      anchor: "harbour wall and",
    });
  });

  it("drops a line-end half word before the next passage brings the whole one", async () => {
    stubRoutes({
      [step("counted seven gulls")]: hits(BOOK, "keeper {{{counted seven gulls}}} on the inter-"),
      [step("seven gulls on the")]: hits(
        BOOK,
        "counted {{{seven gulls on the}}} inter- national rail",
      ),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 2,
      anchorWords: 4,
    });

    expect(read.passage).toBe("keeper counted seven gulls on the inter- national rail");
  });

  it("keeps the last word in the anchor when a lone dash ends the passage", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(BOOK, "keeper {{{counted seven gulls}}} on the rail -"),
      [step("gulls on the rail")]: hits(BOOK, "seven {{{gulls on the rail}}} - and the fog"),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 2,
      anchorWords: 4,
    });

    expect(calledUrl(fetch.mock.calls[1])).toContain("q=gulls+on+the+rail&");
    expect(read.passage).toBe("keeper counted seven gulls on the rail - and the fog");
  });

  it("takes the punctuation after the anchor once, from the next passage", async () => {
    stubRoutes({
      [step("counted seven gulls")]: hits(BOOK, "keeper {{{counted seven gulls}}} on the rail."),
      [step("gulls on the rail")]: hits(BOOK, "seven {{{gulls on the rail}}}. Then the fog"),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 2,
      anchorWords: 4,
    });

    expect(read.passage).toBe("keeper counted seven gulls on the rail. Then the fog");
  });

  it("takes an opening quotation mark once when reading backward", async () => {
    stubRoutes({
      [step("fog rolled over")]: hits(BOOK, "\u201C{{{Fog rolled over}}} the harbour"),
      [step("Fog rolled over the")]: hits(
        BOOK,
        "the rail. \u201C{{{Fog rolled over the}}} harbour",
      ),
    });

    const read = await followText(create("openlibrary"), "fog rolled over", {
      book: BOOK,
      direction: "backward",
      steps: 2,
      anchorWords: 4,
    });

    expect(read.passage).toBe("the rail. \u201CFog rolled over the harbour");
  });

  it("reads backward by prepending the words in front of each match", async () => {
    const fetch = stubRoutes({
      [step("harbour wall and")]: hits(
        BOOK,
        "fog rolled over the {{{harbour wall and}}} swallowed the last",
      ),
      [step("fog rolled over")]: hits(
        BOOK,
        "on the rail before the {{{fog rolled over}}} the harbour",
      ),
    });

    const read = await followText(create("openlibrary"), "harbour wall and", {
      book: BOOK,
      direction: "backward",
      steps: 2,
      anchorWords: 3,
    });

    expect(queries(fetch.mock.calls)).toEqual(["harbour wall and", "fog rolled over"]);
    expect(read.passage).toBe(
      "on the rail before the fog rolled over the harbour wall and swallowed the last",
    );
    expect(read).toMatchObject({ stop: "steps", anchor: "on the rail", direction: "backward" });
  });

  it("stops as lost when a step finds only a passage from elsewhere in the book", async () => {
    stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
      [step("the rail before")]: hits(BOOK, "a sailor leaned over {{{the rail before}}} breakfast"),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      anchorWords: 3,
    });

    expect(read).toMatchObject({
      passage: "keeper counted seven gulls on the rail before",
      searches: 2,
      stop: "lost",
      anchor: "the rail before",
    });
    expect(formatTextFollow(read)).toContain('lost the book: "the rail before"');
  });

  it("stops as lost when the book is missing from a step's hits, without paging on", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
      [step("the rail before")]: hits("otherscan", "x {{{the rail before}}} y"),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 5,
      anchorWords: 3,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(read).toMatchObject({ searches: 2, stop: "lost" });
  });

  it("stops at the end of the scan's passage instead of searching the same words again", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
      [step("the rail before")]: hits(BOOK, "gulls on {{{the rail before}}}"),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 5,
      anchorWords: 3,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(read).toMatchObject({ searches: 2, stop: "end", anchor: "the rail before" });
  });

  it("keeps what it read when a later search fails, and says how to read on", async () => {
    stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
      [step("the rail before")]: { status: 503, body: { error: "down" } },
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      anchorWords: 3,
    });

    expect(read).toMatchObject({
      passage: "keeper counted seven gulls on the rail before",
      searches: 2,
      stop: "error",
      anchor: "the rail before",
    });
    expect(read.error).toContain("503");
    expect(formatTextFollow(read)).toContain('read on: query "the rail before"');
  });

  it("reads past an anchor the book repeats in another place", async () => {
    const fetch = stubRoutes({
      [step("sing it once")]: hits(BOOK, "{{{sing it once}}} then row your boat"),
      [step("row your boat")]: hits(
        BOOK,
        "it once then {{{row your boat}}} and then sing",
        "it twice then {{{row your boat}}} to the end",
      ),
      [step("and then sing")]: hits(BOOK, "boat {{{and then sing}}} it twice then row"),
      [step("twice then row")]: hits(BOOK, "{{{twice then row}}} your boat"),
    });

    const read = await followText(create("openlibrary"), "sing it once", {
      book: BOOK,
      steps: 5,
      anchorWords: 3,
    });

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(read.passage).toBe(
      "sing it once then row your boat and then sing it twice then row your boat to the end",
    );
    expect(read.stop).toBe("steps");
  });

  it("stops as a repeat when the same words come back in the same place", async () => {
    const fetch = stubRoutes({
      [step("la la la")]: hits(BOOK, "{{{la la la}}} la la la"),
    });

    const read = await followText(create("openlibrary"), "la la la", {
      book: BOOK,
      steps: 10,
      anchorWords: 3,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(read).toMatchObject({ searches: 2, stop: "repeat" });
  });

  it("stops at the end when a step adds only punctuation", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
      [step("the rail before")]: hits(BOOK, "gulls on {{{the rail before}}} ."),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 5,
      anchorWords: 3,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(read).toMatchObject({
      passage: "keeper counted seven gulls on the rail before .",
      stop: "end",
    });
  });

  it("reads a zero or negative budget as the least, not the most", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
    });

    await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 0,
      maxPages: -2,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calledUrl(fetch.mock.calls[0])).toContain("page=1&limit=100");
  });

  it("splits a passage full of unclosed markers in linear time", async () => {
    stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
      [step("the rail before")]: hits(BOOK, "{{{".repeat(100_000)),
    });

    const started = performance.now();
    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      anchorWords: 3,
    });

    expect(performance.now() - started).toBeLessThan(500);
    expect(read.stop).toBe("lost");
  });

  it("reports a phrase the book does not hold as not found after one page", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits("otherscan", "x {{{counted seven gulls}}} y"),
    });

    await expect(
      followText(create("openlibrary"), "counted seven gulls", { book: BOOK }),
    ).rejects.toThrow(NotFoundError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty book before any request", async () => {
    const fetch = stubRoutes({});

    await expect(
      followText(create("openlibrary"), "counted seven gulls", { book: "  " }),
    ).rejects.toThrow(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clamps steps to the ceiling and anchor words to the floor", async () => {
    const fetch = stubRoutes({
      [step("counted seven gulls")]: hits(
        BOOK,
        "keeper {{{counted seven gulls}}} on the rail before",
      ),
    });

    const read = await followText(create("openlibrary"), "counted seven gulls", {
      book: BOOK,
      steps: 1,
      anchorWords: 1,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(read).toMatchObject({ searches: 1, stop: "steps", anchor: "the rail before" });
  });
});
