/** CLI-only `get` and `text`: one word names the book, and a word that checks out is an ISBN. */

import { defineTool, Type } from "@agntn/tools";
import { InvalidInputError } from "./core/errors.ts";
import { isIsbn, normalizeIsbn } from "./core/isbn.ts";
import { loadOperations, textTool } from "./tools.ts";

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

/** An ISBN reaches none of the public-domain libraries, so it stops here instead of as a title. */
export const textCommand = defineTool({
  name: "books_text_book",
  title: "Books Text",
  description: "Read a slice of a public-domain book's text",
  effect: "read",
  input: Type.Object(
    {
      book: optionalText(500, "Title of the book; ISBNs do not reach the public-domain libraries"),
      ...Type.Omit(textTool.input, ["title"]).properties,
    },
    { additionalProperties: false },
  ),
  cli: { command: "text", positional: ["book"] },
  execute: async ({ book = "", ...rest }) => {
    const title = book.trim();
    if (isIsbn(title)) {
      throw new InvalidInputError(
        `${normalizeIsbn(title)} is an ISBN, and no library with texts takes one`,
      );
    }
    return (await loadOperations()).booksText({ title, ...rest });
  },
});
