/** CLI-only `get`: one word names the book, an ISBN when it parses as one and a title otherwise. */

import { defineTool, Type } from "@agntn/tools";
import { isIsbn, normalizeIsbn } from "./core/isbn.ts";
import { loadOperations } from "./tools.ts";

const optionalText = (maxLength: number, description: string) =>
  Type.Optional(Type.String({ maxLength, description }));

export const getCommand = defineTool({
  name: "books_get_book",
  title: "Books Get",
  description: "Fetch the bibliographic record of one book",
  effect: "read",
  input: Type.Object(
    {
      book: optionalText(
        500,
        "ISBN or title; an argument that parses as an ISBN is treated as one",
      ),
      author: optionalText(200, "Author, to sharpen a title match"),
      id: optionalText(200, "Provider-native book id from a previous search"),
      provider: optionalText(
        64,
        "Provider, or 'all' to compare every provider; omit to walk until one has it",
      ),
    },
    { additionalProperties: false },
  ),
  cli: { command: "get", positional: ["book"] },
  execute: async ({ book = "", ...rest }) => {
    const named = book.trim();
    const key = isIsbn(named) ? { isbn: normalizeIsbn(named) } : { title: named };
    return (await loadOperations()).booksGet({ ...key, ...rest });
  },
});
