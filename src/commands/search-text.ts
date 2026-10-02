/** Find a phrase inside scanned books */
import { defineCommand } from "citty";
import consola from "consola";
import { formatTextSearch } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { selectProvider } from "../core/resolve.ts";
import { parseNumericArg, runCommand } from "./args.ts";

export default defineCommand({
  meta: {
    name: "search-text",
    description: "Find a phrase inside scanned books and print the passages around it",
  },
  args: {
    query: {
      type: "positional",
      description: "Phrase to find, for example 'the spice must flow'",
      required: true,
    },
    book: {
      type: "string",
      description: "Scan id from a previous match; keep only that book's passages",
    },
    page: {
      type: "string",
      description: "Page of hits to start at",
    },
    limit: {
      type: "string",
      alias: "n",
      description: "Hits on one page (default 20, or 100 with --book)",
    },
    pages: {
      type: "string",
      description: "Pages to read while looking for --book (default 3)",
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
        book: args.book?.trim() || undefined,
        page: parseNumericArg(args.page, "page", { integer: true, min: 1 }),
        limit: parseNumericArg(args.limit, "limit", { integer: true, min: 1 }),
        maxPages: parseNumericArg(args.pages, "pages", { integer: true, min: 1 }),
      };
      const { provider } = selectProvider(args.provider, "searchText");
      const search = requireOperation(provider, "searchText");
      consola.log(formatTextSearch(await search(args.query, options), options));
    });
  },
});
