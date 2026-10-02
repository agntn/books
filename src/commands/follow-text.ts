/** Read on through a scanned book by chaining phrase searches */
import { defineCommand } from "citty";
import consola from "consola";
import { followText } from "../core/follow.ts";
import { formatTextFollow } from "../core/format.ts";
import { selectOneProvider } from "../core/resolve.ts";
import { DEFAULT_ANCHOR_WORDS, DEFAULT_FOLLOW_STEPS, MIN_ANCHOR_WORDS } from "../core/types.ts";
import { parseNumericArg, runCommand } from "./args.ts";

export default defineCommand({
  meta: {
    name: "follow-text",
    description: "Read on through a scanned book from a phrase, one search at a time",
  },
  args: {
    query: {
      type: "positional",
      description: "Phrase found in the book, or the query a previous run ends with",
      required: true,
    },
    book: {
      type: "string",
      description: "Scan id from search-text; the chain reads only this book",
      required: true,
    },
    backward: {
      type: "boolean",
      description: "Read back before the phrase instead of on past it",
    },
    steps: {
      type: "string",
      description: `Searches to run, the first one included (default ${DEFAULT_FOLLOW_STEPS})`,
    },
    anchor: {
      type: "string",
      description: `Words each next search starts from (default ${DEFAULT_ANCHOR_WORDS})`,
    },
    pages: {
      type: "string",
      description: "Pages of 100 hits each search reads while looking for --book (default 1)",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider; omit for the first one that searches inside books",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const options = {
        book: args.book,
        direction: args.backward ? ("backward" as const) : ("forward" as const),
        steps: parseNumericArg(args.steps, "steps", { integer: true, min: 1 }),
        anchorWords: parseNumericArg(args.anchor, "anchor", {
          integer: true,
          min: MIN_ANCHOR_WORDS,
        }),
        maxPages: parseNumericArg(args.pages, "pages", { integer: true, min: 1 }),
      };
      const { provider } = selectOneProvider(args.provider, "searchText");
      consola.log(formatTextFollow(await followText(provider, args.query, options)));
    });
  },
});
