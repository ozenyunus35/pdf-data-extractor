// Reading the values in a cell: numbers in any common notation, and dates.

export type Decimal = "." | ",";

const CURRENCY = /^(?:[$€£¥₺₹₩₽]|US\$|CHF|EUR|USD|GBP|TRY|TL|JPY|INR|PLN|zł|kr|SEK|NOK|DKK)$/i;
const UNIT = /[$€£¥₺₹₩₽¢]|\b(?:US\$|CHF|EUR|USD|GBP|TRY|TL|JPY|INR|PLN|zł|kr|SEK|NOK|DKK)\b/gi;

/** A currency sign, a currency code or a percent sign written on its own next to a number. */
export const isUnit = (s: string) => s === "%" || CURRENCY.test(s);

/**
 * Parse a number as it is printed in reports: "1,234.50", "1.234,50", "1 234,50",
 * "€12", "12 TL", "(45.00)", "45.00-", "−3", "120.00 DR", "12.5%".
 * `decimal` says which mark separates decimals; "1.234" means 1234 with ",".
 * Percentages are returned as printed (12.5), see `isPercent`.
 */
export function toNumber(s: string, decimal: Decimal = "."): number | null {
  // Spaces group thousands only in threes ("229 402,18"); "1 555 0100" is a phone number.
  let t = s.normalize("NFKC").replace(/[−–]/g, "-").replace(/(\d)[\s']+(?=\d{3}(?!\d))/g, "$1").trim();
  let negative = false;
  const dc = t.match(/^(.*?\d)\s*(CR|DR|Cr|Dr|Alacak|Borç)$/);
  if (dc) {
    t = dc[1];
    negative = /^(DR|Dr|Borç)$/.test(dc[2]);
  }
  t = t.replace(UNIT, "").trim();
  if (/\d\s+\d/.test(t)) return null;
  t = t.replace(/\s+/g, "").replace(/%$/, "");
  if (/^\(.*\)$/.test(t)) (negative = !negative), (t = t.slice(1, -1));
  if (/^-.*-$/.test(t)) return null;
  if (/-$/.test(t)) (negative = !negative), (t = t.slice(0, -1));
  if (/^[+-]/.test(t)) (negative = t[0] === "-" ? !negative : negative), (t = t.slice(1));
  t = t.replace(UNIT, "");
  const group = decimal === "." ? "," : ".";
  const g = group === "." ? "\\." : ",";
  const d = decimal === "." ? "\\." : ",";
  if (!new RegExp(`^(\\d{1,3}(${g}\\d{3})+|\\d+)(${d}\\d+)?$|^${d}\\d+$`).test(t)) return null;
  const n = Number(t.split(group).join("").replace(decimal, "."));
  return negative ? -n : n;
}

export const isPercent = (s: string) => /\d\s*%$/.test(s.trim());

/**
 * Which mark is the decimal separator in a set of numbers. "1.234,56" and "0,37"
 * say comma, "1,234.56" and "0.37" say dot; "1.234" alone is ambiguous.
 */
export function decimalOf(values: string[]): Decimal {
  let comma = 0, dot = 0;
  for (const v of values) {
    const t = v.replace(/[\s  ]/g, "");
    if (/\d\.\d{3},\d|\d,\d{1,2}(?!\d)/.test(t)) comma++;
    else if (/\d,\d{3}\.\d|\d\.\d{1,2}(?!\d)/.test(t)) dot++;
  }
  return comma > dot ? "," : ".";
}

const MONTHS: Record<string, number> = {};
[
  "jan feb mar apr may jun jul aug sep oct nov dec",
  "january february march april may june july august september october november december",
  "oca şub mar nis may haz tem ağu eyl eki kas ara",
  "ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık",
  "jan feb mär apr mai jun jul aug sep okt nov dez",
  "januar februar märz april mai juni juli august september oktober november dezember",
  "janv févr mars avr mai juin juil août sept oct nov déc",
  "ene feb mar abr may jun jul ago sep oct nov dic",
].forEach((l) => l.split(" ").forEach((m, i) => (MONTHS[m] = i + 1)));
MONTHS.sept = 9;

/** Day-first (14/03/2026) or month-first (03/14/2026) for slashed dates. */
export type DateOrder = "dmy" | "mdy";

/** Parses one date; returns [year, month, day] or null. */
export function toDate(s: string, order: DateOrder = "dmy"): [number, number, number] | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, " ");
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const ok = (y: number, m: number, d: number): [number, number, number] | null =>
    m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 1900 && y <= 2100 ? [y, m, d] : null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})$/);
  if (m) {
    const [a, b] = [+m[1], +m[3]];
    // Dots and dashes are day-first everywhere; slashes follow the column's order unless a part is above 12.
    const dayFirst = m[2] !== "/" || a > 12 || (b <= 12 && order === "dmy");
    return dayFirst ? ok(year(m[4]), b, a) : ok(year(m[4]), a, b);
  }
  m = t.match(/^(\d{1,2})[ .-]?([a-zçğışöüéûä]+)\.?[ ,.-]+(\d{4}|\d{2})$/);
  if (m && MONTHS[m[2]]) return ok(year(m[3]), MONTHS[m[2]], +m[1]);
  m = t.match(/^([a-zçğışöüéûä]+)\.? (\d{1,2}),? (\d{4})$/);
  if (m && MONTHS[m[1]]) return ok(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

/** Slashed dates are month-first only when a column shows a month above 12 in the first place. */
export function dateOrderOf(values: string[]): DateOrder {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? "mdy" : "dmy";
}
