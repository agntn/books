/** Fetch the bibliographic record of one book */
import { defineCommand } from "citty";
import consola from "consola";
import { bookAll, bookWithFallback } from "../core/all.ts";
import { formatBook, formatBookAll, formatFallback } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { isAllProviders, providerArg, selectProvider } from "../core/resolve.ts";
import { runCommand, toBookQuery } from "./args.ts";

export default defineCommand({
  meta: {
    name: "get",
    description: "Fetch the bibliographic record of one book",
  },
  args: {
    book: {
      type: "positional",
      description: "ISBN or title; an argument that parses as an ISBN is treated as one",
      required: false,
    },
    provider: {
      type: "string",
      alias: "p",
      description: 'Provider, or "all" to compare every provider; omit to walk until one has it',
    },
    author: {
      type: "string",
      alias: "a",
      description: "Author, to sharpen a title match",
    },
    id: {
      type: "string",
      description: "Provider-native book id from a previous search",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const query = toBookQuery(args);

      if (isAllProviders(args.provider)) {
        consola.log(formatBookAll(await bookAll(query)));
        return;
      }

      if (!providerArg(args.provider)) {
        consola.log(formatFallback(await bookWithFallback(query), formatBook));
        return;
      }

      const { provider } = selectProvider(args.provider);
      consola.log(formatBook(await requireOperation(provider, "book")(query)));
    });
  },
});
