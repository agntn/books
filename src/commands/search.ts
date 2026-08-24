/** Find books matching a free-form query */
import { defineCommand } from "citty";
import consola from "consola";
import { searchAll } from "../core/all.ts";
import { formatBooks, formatSearchAll } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { isAllProviders, selectProvider } from "../core/resolve.ts";
import { parseNumericArg } from "./args.ts";

export default defineCommand({
  meta: {
    name: "search",
    description: "Search providers for books matching a query",
  },
  args: {
    query: {
      type: "positional",
      description: "Free-form query, for example 'dune frank herbert'",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: 'Provider, or "all" to compare every provider',
    },
    limit: {
      type: "string",
      alias: "n",
      description: "Maximum number of results",
    },
  },
  async run({ args }) {
    try {
      const limit = parseNumericArg(args.limit, "limit", { integer: true, min: 1 });

      if (isAllProviders(args.provider)) {
        consola.log(formatSearchAll(args.query, await searchAll(args.query, { limit })));
        return;
      }
      const { name, provider } = selectProvider(args.provider, "search");
      const search = requireOperation(provider, "search");
      consola.log(formatBooks(name, args.query, await search(args.query, { limit })));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
