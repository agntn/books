/**
 * Keep the suite hermetic.
 *
 * No built-in provider reads a credential today - every backend is a public catalog - but a
 * provider registered by a host application could, and a forgotten fetch stub must fail loudly
 * rather than turn into a live request against somebody's account.
 */
import { afterEach } from "vite-plus/test";

delete process.env.BOOKS_API_KEY;

/** URLs a test sent past its stub, kept here because a provider may swallow the rejection. */
const escaped: string[] = [];

/** A server the test started itself on this machine is fair game; a catalog is not. */
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

const realFetch = globalThis.fetch;

/**
 * Stand in for `fetch` until a test stubs its own; `vi.unstubAllGlobals()` brings it back.
 *
 * @param {...Parameters<typeof fetch>} args What the code under test asked for.
 * @returns {Promise<Response>} A loopback server's answer; any other request rejects.
 */
async function guardedFetch(...args: Readonly<Parameters<typeof fetch>>): Promise<Response> {
  const [input] = args;
  const url = input instanceof Request ? input.url : String(input);
  if (URL.canParse(url) && LOOPBACK.has(new URL(url).hostname)) return realFetch(...args);
  escaped.push(url);
  throw new Error("this test has no fetch stub");
}

globalThis.fetch = guardedFetch;

afterEach(() => {
  const urls = escaped.splice(0);
  if (urls.length > 0) throw new Error(`a test reached for the network: ${urls.join(", ")}`);
});
