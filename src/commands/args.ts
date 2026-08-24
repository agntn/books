/** Argument parsing shared by the CLI commands. */

import consola from "consola";
import { isIsbn, normalizeIsbn } from "../core/isbn.ts";
import type { BookQuery } from "../core/types.ts";

/**
 * Read a numeric CLI argument, or exit with a message naming the flag.
 *
 * citty has no numeric argument type, so every command would parse and validate its own.
 */
export function parseNumericArg(
  raw: string | undefined,
  flag: string,
  options?: { integer?: boolean; min?: number },
): number | undefined {
  if (raw === undefined) return undefined;
  const value = options?.integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  const min = options?.min ?? 0;
  if (!Number.isFinite(value) || value < min) {
    consola.error(`Invalid ${flag}: ${raw}`);
    process.exit(1);
  }
  return value;
}

/**
 * Turn the positional argument of `get` and `text` into a book query.
 *
 * The positional is whatever names the book: an ISBN if it parses as one, a title otherwise.
 * Nobody types `--isbn` in front of a number that is visibly an ISBN, and a title that happens
 * to be thirteen digits with a valid check digit is not a title anyone has.
 */
export function toBookQuery(args: { book?: string; author?: string; id?: string }): BookQuery {
  const book = args.book?.trim();
  if (!book) return { author: args.author, id: args.id };
  return isIsbn(book)
    ? { isbn: normalizeIsbn(book), author: args.author, id: args.id }
    : { title: book, author: args.author, id: args.id };
}

/**
 * Run a command body, turning any failure into one line and a non-zero exit.
 *
 * Every command needs the same ending, and three copies of it drift the moment one of them
 * learns a new exit code or output shape.
 */
export async function runCommand(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    consola.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
