/** Auto-select a provider from the environment and the operation being requested */

import { create, has, isConfigured, providers, supportsOperation } from "./registry.ts";
import { InvalidInputError, UnknownProviderError } from "./errors.ts";
import type { Provider, ProviderOperation } from "./provider.ts";
import type { ProviderCapabilities } from "./types.ts";

export { isConfigured } from "./registry.ts";

/**
 * Normalize a caller-supplied provider argument.
 *
 * Empty and whitespace-only strings mean "no preference". Every surface asks this question, and
 * each one that answered it inline drifted: a truthiness check treats `"  "` as a named provider
 * and skips the fallback walk the caller expected.
 */
export function providerArg(value?: string): string | undefined {
  return value?.trim() || undefined;
}

/**
 * Registered providers that serve `capability` and are usable in this environment, in
 * registration order.
 *
 * The four operations are one question and the two result kinds are another, but callers need
 * both from one list: an ISBN lookup that walks a catalog which cannot search by ISBN wastes a
 * request and reports "not found" for a book the next provider has.
 */
export function usableProviders(capability: keyof ProviderCapabilities): string[] {
  return providers().filter(
    (name) => isConfigured(name) && create(name).capabilities[capability] === true,
  );
}

/**
 * Check for the reserved "all" provider value, which fans a request out to every registered
 * provider instead of selecting one. Surfaces test this before calling `selectProvider`.
 */
export function isAllProviders(preferred?: string): boolean {
  return preferred?.trim().toLowerCase() === "all";
}

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference always wins, even when the provider does not serve `operation` - the
 * caller then gets `UnsupportedOperationError` naming their own choice instead of a silent
 * switch to a different backend.
 *
 * Without a preference, candidates are those that serve the operation and are usable right now,
 * and registration order decides among them: the broadest catalog first, the two public-domain
 * libraries next, the regional catalogs last.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 */
export function resolveProvider(preferred?: string, operation: ProviderOperation = "book"): string {
  if (preferred) {
    if (!has(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    return preferred;
  }

  const [usable] = usableProviders(operation);
  if (usable) return usable;

  const [capable] = providers().filter((name) => supportsOperation(name, operation));
  if (capable) return capable;

  throw new UnknownProviderError(`no registered provider serves ${operation}`);
}

/** A provider instance paired with its registry key. */
export interface SelectedProvider {
  /** Registry key of the selected provider */
  name: string;
  /** Ready-to-use provider instance */
  provider: Provider;
}

/**
 * Resolve the provider one request should use.
 *
 * This is the single selection path shared by the CLI, MCP server, AI tools, and both agent
 * extensions. Empty or whitespace-only arguments count as absent, so a client that sends `""`
 * gets the same behavior as one that omits the field.
 */
export function selectProvider(
  preferred?: string,
  operation: ProviderOperation = "book",
): SelectedProvider {
  const name = resolveProvider(providerArg(preferred), operation);
  return { name, provider: create(name) };
}

/** `selectProvider` for an operation without a fan-out, refusing the reserved "all" by name. */
export function selectOneProvider(
  preferred: string | undefined,
  operation: ProviderOperation,
): SelectedProvider {
  if (isAllProviders(preferred)) {
    throw new InvalidInputError(`${operation} reads one provider; leave provider empty`);
  }
  return selectProvider(preferred, operation);
}
