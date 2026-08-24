/** Read the full text of a public-domain book */
import { defineCommand } from "citty";
import consola from "consola";
import { textWithFallback } from "../core/all.ts";
import { formatFallback, formatText } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { providerArg, selectProvider } from "../core/resolve.ts";
import { parseNumericArg, toBookQuery } from "./args.ts";

export default defineCommand({
  meta: {
    name: "text",
    description: "Read a slice of a public-domain book's text",
  },
  args: {
    book: {
      type: "positional",
      description: "Title of the book; ISBNs do not reach the public-domain libraries",
      required: false,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider; omit to walk the libraries that carry texts",
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
    offset: {
      type: "string",
      alias: "o",
      description: "Byte offset to start reading at",
    },
    bytes: {
      type: "string",
      alias: "b",
      description: "Maximum bytes to read in one call (default 32768)",
    },
  },
  async run({ args }) {
    try {
      const query = toBookQuery(args);
      const options = {
        offset: parseNumericArg(args.offset, "offset", { integer: true }),
        maxBytes: parseNumericArg(args.bytes, "bytes", { integer: true, min: 1 }),
      };

      if (!providerArg(args.provider)) {
        consola.log(formatFallback(await textWithFallback(query, options), formatText));
        return;
      }

      const { provider } = selectProvider(args.provider, "text");
      consola.log(formatText(await requireOperation(provider, "text")(query, options)));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
