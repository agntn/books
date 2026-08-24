/**
 * HTML reading shared by the providers that parse pages instead of calling an API.
 *
 * Two catalogs, one contract: read the structured data a page already publishes for search
 * engines, and fail loudly when it is gone. Schema.org JSON-LD and OpenGraph meta tags are the
 * durable surface of a book page - the class names around them get renamed with every redesign,
 * while `books:isbn` and `"@type": "Book"` are a promise the site makes to crawlers.
 */

import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { ParseError } from "./errors.ts";

/** Parse a page after turning `<br>` into a newline, so blurbs keep their line breaks. */
export function parseHtml(html: string): HTMLElement {
  return parse(html.replace(/<br\s*\/?>/gi, "\n"));
}

/** Text of the first element matching `selector`, or `undefined` when nothing matches. */
export function selectText(root: HTMLElement, selector: string): string | undefined {
  const text = root.querySelector(selector)?.text?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
}

/** Attribute of the first element matching `selector`, or `undefined` when nothing matches. */
export function selectAttribute(
  root: HTMLElement,
  selector: string,
  attribute: string,
): string | undefined {
  const value = root.querySelector(selector)?.getAttribute(attribute)?.trim();
  return value ? value : undefined;
}

/** Content of a `<meta property="…">` tag, the shape OpenGraph and its book extension use. */
export function metaContent(root: HTMLElement, property: string): string | undefined {
  return selectAttribute(root, `meta[property="${property}"]`, "content");
}

/** JSON-LD node: an object keyed by `@type` plus whatever schema.org properties it carries. */
export type JsonLdNode = Record<string, unknown> & { "@type"?: unknown };

/**
 * Parse one JSON-LD block, salvaging the bibliographic fields when reviews break it.
 *
 * A book page embeds its reader reviews in the same node, and review text is written by people:
 * one unescaped quotation mark inside a `reviewBody` makes the whole block unparseable. That is
 * not hypothetical - it is the state of the Lubimyczytać page for Dune, where a review opens
 * with `"Diuna" jest…`. Since `review` is the last property, cutting the node off in front of it
 * yields valid JSON carrying every field a bibliographic record needs.
 */
function parseJsonLdBlock(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const cut = text.indexOf('"review"');
    if (cut === -1) return undefined;
    try {
      return JSON.parse(`${text.slice(0, cut).replace(/[,\s]+$/, "")}}`);
    } catch {
      return undefined;
    }
  }
}

function collectNodes(value: unknown, into: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as JsonLdNode;
  into.push(node);
  if ("@graph" in node) collectNodes(node["@graph"], into);
}

/**
 * First JSON-LD node of the wanted `@type` on the page.
 *
 * A page carries several: the site's `Organization`, a `BreadcrumbList`, and the `Book` itself.
 * Arrays and `@graph` wrappers are both in use, so the search walks whatever shape it finds
 * rather than assuming one.
 */
export function jsonLd(root: HTMLElement, type: string): JsonLdNode | undefined {
  const nodes: JsonLdNode[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    collectNodes(parseJsonLdBlock(script.text), nodes);
  }
  return nodes.find((node) => node["@type"] === type);
}

/**
 * Same as `jsonLd`, but a missing node is an error rather than `undefined`.
 *
 * @throws {ParseError} When the page carries no node of that type, which means the site changed
 *   its markup - the request itself succeeded.
 */
export function requireJsonLd(
  root: HTMLElement,
  type: string,
  provider: string,
  url: string,
): JsonLdNode {
  const node = jsonLd(root, type);
  if (!node) {
    throw new ParseError(`page carries no JSON-LD "${type}" node`, provider, url);
  }
  return node;
}

/** Read a JSON-LD property as a string, accepting the number a site may print instead. */
export function ldString(node: JsonLdNode | undefined, key: string): string | undefined {
  const value = node?.[key];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Read a JSON-LD property that may be a node, a list of nodes, or a bare string, and return the
 * `name` of each - the shape `author`, `genre` and `inLanguage` all take in the wild.
 */
export function ldNames(node: JsonLdNode | undefined, key: string): string[] {
  const value = node?.[key];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (typeof item === "object" && item !== null) {
        const name = (item as JsonLdNode)["name"];
        return typeof name === "string" ? name.trim() : "";
      }
      return "";
    })
    .filter((name) => name !== "");
}
