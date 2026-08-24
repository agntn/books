/**
 * Keep the suite hermetic.
 *
 * No built-in provider reads a credential today - every backend is a public catalog - but a
 * provider registered by a host application could, and a forgotten fetch stub must fail loudly
 * rather than turn into a live request against somebody's account.
 */
delete process.env.BOOKS_API_KEY;
