/** Side-effect import: registers every built-in provider. */
import "./providers/index.ts";

export { version } from "./version.ts";
export type {
  Book,
  BookFormat,
  BookMatch,
  BookQuery,
  BookText,
  ProviderCapabilities,
  ProviderConfig,
  Rating,
  SearchOptions,
  TextOptions,
} from "./core/types.ts";
export {
  DEFAULT_TEXT_BYTES,
  MAX_TEXT_BYTES,
  clampMaxResults,
  clampTextBytes,
  toRating,
} from "./core/types.ts";
export {
  Provider,
  assertBookQuery,
  assertHttpUrl,
  assertQuery,
  requireOperation,
} from "./core/provider.ts";
export type { ProviderConstructor, ProviderOperation } from "./core/provider.ts";
export {
  BooksError,
  HTTPError,
  AuthError,
  PaymentError,
  RateLimitError,
  NotFoundError,
  ParseError,
  UnsupportedOperationError,
  UnknownProviderError,
  InvalidInputError,
  normalizeError,
} from "./core/errors.ts";
export { buildQuery, getJSON, getText, readTextSlice } from "./core/client.ts";
export type { ClientOptions, TextSlice } from "./core/client.ts";
export {
  assertIsbn,
  isIsbn,
  isIsbn10,
  isIsbn13,
  isbn10To13,
  normalizeIsbn,
  toIsbn10,
  toIsbn13,
} from "./core/isbn.ts";
export {
  jsonLd,
  ldNames,
  ldString,
  metaContent,
  parseHtml,
  requireJsonLd,
  selectAttribute,
  selectText,
} from "./core/html.ts";
export type { JsonLdNode } from "./core/html.ts";
export { normalizeText, parseYear, trimPartialUtf8, uniqueStrings } from "./core/text.ts";
export type { TrimmedBytes } from "./core/text.ts";
export {
  register,
  create,
  providers,
  has,
  getDefaultURL,
  getEnvKey,
  listProviders,
  supportsOperation,
} from "./core/registry.ts";
export type { ProviderListing } from "./core/registry.ts";
export {
  isAllProviders,
  isConfigured,
  providerArg,
  resolveProvider,
  selectProvider,
  usableProviders,
} from "./core/resolve.ts";
export type { SelectedProvider } from "./core/resolve.ts";
export {
  bookAll,
  bookWithFallback,
  searchAll,
  serializeOutcomes,
  textWithFallback,
} from "./core/all.ts";
export type { FallbackResult, ProviderOutcome, SerializedOutcome } from "./core/all.ts";
export {
  formatBook,
  formatBookAll,
  formatBookHeader,
  formatBookLine,
  formatBooks,
  formatFallback,
  formatProviders,
  formatRating,
  formatSearchAll,
  formatText,
} from "./core/format.ts";
