/** Zod fragments shared by the MCP server and the AI SDK tools. */

import { z } from "zod";
import { MAX_TEXT_BYTES } from "./types.ts";

/** Optional provider selector; empty-like strings are rejected before selection. */
export const providerInput = {
  provider: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Book provider key, or 'all' to query every provider and compare"),
};

/** Free-form query for book search. */
export const queryInput = z
  .string()
  .trim()
  .min(1)
  .describe("Free-form search query, for example 'dune frank herbert'");

/** ISBN of the wanted edition, in either length. */
export const isbnInput = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .optional()
  .describe("ISBN-10 or ISBN-13; hyphens are ignored and the check digit is verified");

/** Title of the wanted book. */
export const titleInput = z.string().trim().min(1).optional().describe("Book title");

/** Author, used to sharpen a title match. */
export const authorInput = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Author, used to sharpen a title match; never enough on its own");

/** Provider-native identifier carried over from a search result. */
export const bookIdInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe("Provider-native book id from a previous search on the same provider");

/** Search result bound; providers clamp to their own maximum. */
export const limitInput = z
  .number()
  .int()
  .positive()
  .max(50)
  .optional()
  .describe("Max results; providers cap this at 10-20 and silently truncate");

/** Where in the file a text slice starts. */
export const offsetInput = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe("Byte offset to start reading at; use the nextOffset of the previous slice");

/** How much of the file one text slice may carry. */
export const maxBytesInput = z
  .number()
  .int()
  .positive()
  .max(MAX_TEXT_BYTES)
  .optional()
  .describe(`Max bytes to read in one call, up to ${MAX_TEXT_BYTES}; defaults to 32768`);
