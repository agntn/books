/**
 * National Library of Poland provider - data.bn.org.pl, the Polish national bibliography
 *
 * No API key. The flat fields of a record are MARC subfields concatenated with spaces, which is
 * why an author reads `Sapkowski, Andrzej (1948- ) SuperNowa Sapkowski, Andrzej (1948- ).`; the
 * same response carries the underlying MARC, so this provider reads that instead and falls back
 * to the flat fields only for what MARC does not hold.
 *
 * API: https://data.bn.org.pl/docs/institutions (REST, JSON)
 */

import type {
  Book,
  BookMatch,
  BookQuery,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
} from "../core/types.ts";
import { Provider, assertBookQuery, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { InvalidInputError, NotFoundError } from "../core/errors.ts";
import { isbn10To13, toIsbn10, toIsbn13 } from "../core/isbn.ts";
import { register } from "../core/registry.ts";
import { normalizeText, parseYear, uniqueStrings } from "../core/text.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://data.bn.org.pl";

/** Record ids are the numeric `id` of a bibliographic record. */
const RECORD_ID = /^\d+$/;

/** MARC tags this provider reads. */
const TAG = {
  isbn: "020",
  language: "041",
  mainAuthor: "100",
  title: "245",
  imprintOld: "260",
  imprint: "264",
  physical: "300",
  series: "490",
  summary: "520",
  subject: "650",
  genre: "655",
  addedAuthor: "700",
} as const;

/** A MARC data field: indicators plus an ordered list of single-key subfields. */
interface MarcDataField {
  ind1?: string;
  ind2?: string;
  subfields?: Record<string, string>[];
}

/** Each entry of `marc.fields` is an object with exactly one key: the MARC tag. */
type MarcField = Record<string, string | MarcDataField>;

interface BnRecord {
  id?: number;
  /** Withdrawn records stay in the response with their fields emptied */
  deleted?: boolean;
  title?: string;
  author?: string;
  publisher?: string;
  publicationYear?: string;
  isbnIssn?: string;
  language?: string;
  languageOfOriginal?: string;
  subject?: string;
  genre?: string;
  kind?: string;
  formOfWork?: string;
  placeOfPublication?: string;
  marc?: { leader?: string; fields?: MarcField[] };
}

interface BnResponse {
  bibs?: BnRecord[];
  nextPage?: string;
}

/** All values of one subfield of one MARC tag, in record order. */
function marcValues(record: BnRecord, tag: string, subfield: string): string[] {
  const values: string[] = [];
  for (const field of record.marc?.fields ?? []) {
    const data = field[tag];
    if (!data || typeof data === "string") continue;
    for (const entry of data.subfields ?? []) {
      const value = entry[subfield];
      if (value) values.push(value.trim());
    }
  }
  return values;
}

/**
 * First value of one subfield, stripped of its ISBD dressing.
 *
 * Cataloguing rules end a subfield with the punctuation that introduces the next one - `Title /`
 * before a statement of responsibility, `Publisher,` before a date - and put a publisher's name
 * in quotation marks. None of that is part of the value.
 */
function marcValue(record: BnRecord, tag: string, subfield: string): string | undefined {
  const value = marcValues(record, tag, subfield)[0];
  if (!value) return undefined;
  return (
    value
      .replace(/\s*[/:;,=]$/, "")
      .replace(/^"(.*)"$/, "$1")
      .trim() || undefined
  );
}

/** `295 s. ;` and `XII, 400 stron` both mean a page count. */
function parsePages(physical: string | undefined): number | undefined {
  const pages = physical?.match(/(\d+)\s*(?:s\.|str|stron)/i)?.[1];
  return pages ? Number(pages) : undefined;
}

/** The flat `isbnIssn` field holds every identifier of the record, space separated. */
function splitIdentifiers(record: BnRecord): string[] {
  return uniqueStrings([
    ...marcValues(record, TAG.isbn, "a"),
    ...(record.isbnIssn?.split(/\s+/) ?? []),
  ]);
}

/**
 * The two forms of one edition's ISBN, never of two different editions.
 *
 * A record lists every identifier it knows: the print run, the reissue, the audiobook. Taking
 * the first valid ten-digit number and the first valid thirteen-digit one independently prints
 * them side by side as if they were the same book in two notations, which for a title with
 * several editions they are not. The first valid identifier decides, and the other form is only
 * reported when it converts to exactly that number.
 */
function readIsbns(record: BnRecord): { isbn10?: string; isbn13?: string } {
  const identifiers = splitIdentifiers(record);
  const primary = identifiers.find((value) => toIsbn13(value) !== undefined);
  const isbn13 = toIsbn13(primary);
  const isbn10 =
    toIsbn10(primary) ??
    identifiers.find((value) => {
      const ten = toIsbn10(value);
      return ten !== undefined && isbn10To13(ten) === isbn13;
    });
  return { isbn10: toIsbn10(isbn10), isbn13 };
}

/** Title, subtitle and the statement of responsibility, as MARC 245 records them. */
function readTitle(record: BnRecord): { title: string; subtitle?: string } {
  const title = marcValue(record, TAG.title, "a") ?? record.title?.split(" / ")[0]?.trim() ?? "";
  return { title, subtitle: marcValue(record, TAG.title, "b") };
}

function readAuthors(record: BnRecord): string[] {
  const authors = [
    ...marcValues(record, TAG.mainAuthor, "a"),
    ...marcValues(record, TAG.addedAuthor, "a"),
  ].map((name) => name.replace(/\s*[,.]$/, ""));
  return uniqueStrings(authors);
}

class Bn extends Provider {
  static readonly key = "bn";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      book: true,
      text: false,
      isbn: true,
      ratings: false,
    };
  }

  override async search(query: string, options?: SearchOptions): Promise<BookMatch[]> {
    assertQuery(query, Bn.key);
    const limit = clampMaxResults(options?.limit, MAX_RESULTS);
    // The catalog indexes fields, not free text: there is no parameter that searches everything.
    // A query is tried as a title first and as an author only when the title index has nothing,
    // which is what makes a bare surname work without costing every caller a second request.
    const byTitle = await this.query({ title: query.trim(), limit });
    const records =
      byTitle.length > 0 ? byTitle : await this.query({ author: query.trim(), limit });
    return records.map((record) => this.toMatch(record));
  }

  async book(query: BookQuery): Promise<Book> {
    const checked = assertBookQuery(query, Bn.key);
    const record = await this.locate(checked);

    const { title, subtitle } = readTitle(record);
    const { isbn10, isbn13 } = readIsbns(record);
    const physical = marcValue(record, TAG.physical, "a");
    const published =
      marcValue(record, TAG.imprint, "c") ??
      marcValue(record, TAG.imprintOld, "c") ??
      record.publicationYear;
    const summary = marcValues(record, TAG.summary, "a").join("\n");

    return {
      provider: Bn.key,
      title,
      subtitle,
      authors: readAuthors(record),
      year: parseYear(published),
      published,
      publisher:
        marcValue(record, TAG.imprint, "b") ??
        marcValue(record, TAG.imprintOld, "b") ??
        record.publisher?.split(/\s{2,}|"/)[0]?.trim(),
      isbn10,
      isbn13,
      pages: parsePages(physical),
      languages: uniqueStrings([
        marcValue(record, TAG.language, "a"),
        record.language,
        record.languageOfOriginal,
      ]),
      subjects: uniqueStrings([
        ...marcValues(record, TAG.subject, "a"),
        ...marcValues(record, TAG.genre, "a"),
        record.formOfWork,
      ]).slice(0, 25),
      series: marcValue(record, TAG.series, "a"),
      description: summary ? normalizeText(summary) : undefined,
      id: record.id === undefined ? undefined : String(record.id),
      url: this.recordUrl(record.id),
      attribution: "Bibliographic data from the National Library of Poland (data.bn.org.pl)",
    };
  }

  private toMatch(record: BnRecord): BookMatch {
    const { title } = readTitle(record);
    return {
      title,
      authors: readAuthors(record),
      year: parseYear(record.publicationYear),
      id: record.id === undefined ? undefined : String(record.id),
      isbn: readIsbns(record).isbn13,
      language: record.language,
      url: this.recordUrl(record.id),
    };
  }

  /** The API is a data endpoint; the record a human reads lives on the catalog site. */
  private recordUrl(id: number | undefined): string | undefined {
    return id === undefined
      ? undefined
      : `${this.baseUrl}/api/institutions/bibs.json${buildQuery({ id })}`;
  }

  private async locate(query: BookQuery): Promise<BnRecord> {
    if (query.id) {
      const id = query.id.trim();
      if (!RECORD_ID.test(id)) {
        throw new InvalidInputError(
          `id must be a numeric National Library record id, got "${query.id}"`,
          Bn.key,
        );
      }
      const [record] = await this.query({ id, limit: 1 });
      if (!record) throw new NotFoundError(`record ${id}`, Bn.key);
      return record;
    }

    if (query.isbn) {
      const [record] = await this.query({ isbnIssn: query.isbn, limit: 1 });
      if (!record) throw new NotFoundError(`ISBN ${query.isbn}`, Bn.key);
      return record;
    }

    const [record] = await this.query({ title: query.title, author: query.author, limit: 1 });
    if (!record) {
      throw new NotFoundError([query.title, query.author].filter(Boolean).join(" / "), Bn.key);
    }
    return record;
  }

  /**
   * One call to the bibliographic endpoint.
   *
   * Only documented parameters are ever sent: the API ignores what it does not recognize and
   * answers with the head of the whole catalog, so a typo would return real-looking records for
   * a query nobody made.
   */
  private async query(params: {
    title?: string;
    author?: string;
    isbnIssn?: string;
    id?: string;
    limit?: number;
  }): Promise<BnRecord[]> {
    const url = `${this.baseUrl}/api/institutions/bibs.json${buildQuery({ ...params })}`;
    const data = await this.getJSON<BnResponse>(url);
    return (data.bibs ?? []).filter((record) => !record.deleted);
  }
}

register(Bn, DEFAULT_BASE_URL);
