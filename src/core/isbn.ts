/**
 * ISBN handling shared by every provider.
 *
 * An ISBN is the one identifier that crosses catalogs, and each catalog prints it its own way:
 * hyphenated, spaced, ten digits, thirteen, prefixed with the literal word "ISBN". Normalizing
 * and verifying it here means a caller's typo is caught before a request goes out, rather than
 * turning into a lookup that quietly answers with the wrong book.
 */

import { InvalidInputError } from "./errors.ts";

/** Strip separators and the literal "ISBN" label; digits and a trailing `X` survive. */
export function normalizeIsbn(value: string): string {
  return value
    .toUpperCase()
    .replace(/ISBN(?:-1[03])?:?/g, "")
    .replace(/[^0-9X]/g, "");
}

/** True when `value` is a well-formed ISBN-10, check digit included. */
export function isIsbn10(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index++) {
    const character = isbn[index] ?? "";
    sum += (10 - index) * (character === "X" ? 10 : Number(character));
  }
  return sum % 11 === 0;
}

/** True when `value` is a well-formed ISBN-13, check digit included. */
export function isIsbn13(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let index = 0; index < 13; index++) {
    sum += Number(isbn[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

/** True when `value` is a valid ISBN in either length. */
export function isIsbn(value: string): boolean {
  return isIsbn10(value) || isIsbn13(value);
}

/**
 * Convert a valid ISBN-10 to its ISBN-13 form.
 *
 * @throws {InvalidInputError} When `value` is not a valid ISBN-10.
 */
export function isbn10To13(value: string): string {
  const isbn = normalizeIsbn(value);
  if (!isIsbn10(isbn)) {
    throw new InvalidInputError(`not a valid ISBN-10: ${value}`);
  }
  const body = `978${isbn.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < 12; index++) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/**
 * Convert a valid ISBN-13 to its ISBN-10 form.
 *
 * Only the `978` range has one; a `979` number cannot be written in ten digits.
 *
 * @returns The ISBN-10, or `undefined` for a `979` number.
 * @throws {InvalidInputError} When `value` is not a valid ISBN-13.
 */
export function isbn13To10(value: string): string | undefined {
  const isbn = normalizeIsbn(value);
  if (!isIsbn13(isbn)) {
    throw new InvalidInputError(`not a valid ISBN-13: ${value}`);
  }
  if (!isbn.startsWith("978")) return undefined;
  const body = isbn.slice(3, 12);
  let sum = 0;
  for (let index = 0; index < 9; index++) {
    sum += (10 - index) * Number(body[index]);
  }
  const check = (11 - (sum % 11)) % 11;
  return `${body}${check === 10 ? "X" : check}`;
}

/** Normalize any valid ISBN to its 13-digit form, or `undefined` when it is not one. */
export function toIsbn13(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const isbn = normalizeIsbn(value);
  if (isIsbn13(isbn)) return isbn;
  if (isIsbn10(isbn)) return isbn10To13(isbn);
  return undefined;
}

/** Return the 10-digit form when `value` is one, otherwise `undefined`. */
export function toIsbn10(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const isbn = normalizeIsbn(value);
  return isIsbn10(isbn) ? isbn : undefined;
}

/**
 * Normalize a caller-supplied ISBN, rejecting one that fails its check digit.
 *
 * A mistyped ISBN is a different book, not a missing one: catalogs answer for whatever number
 * they are handed, so validating here is what keeps a typo from returning a plausible record
 * for the wrong title.
 *
 * @throws {InvalidInputError} When `value` is not a valid ISBN-10 or ISBN-13.
 */
export function assertIsbn(value: string, provider?: string): string {
  const isbn = normalizeIsbn(value);
  if (!isIsbn(isbn)) {
    throw new InvalidInputError(`not a valid ISBN: ${value}`, provider);
  }
  return isbn;
}
