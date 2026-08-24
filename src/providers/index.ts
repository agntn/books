/**
 * Self-registering provider imports - each import triggers register().
 *
 * Order matters: it is the order `resolveProvider`, `bookWithFallback` and `textWithFallback`
 * walk. The broadest catalog comes first, the two public-domain libraries next - they are the
 * only ones that carry texts - and the two Polish catalogs last, where a book the others missed
 * is most likely to turn up.
 */
import "./openlibrary.ts";
import "./gutendex.ts";
import "./wolnelektury.ts";
import "./bn.ts";
import "./lubimyczytac.ts";
