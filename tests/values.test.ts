// Cell values as reports print them: numbers in several locales, signs, units and dates.
import assert from "node:assert/strict";
import { decimalOf, toDate, toNumber, type Decimal } from "../src/values.ts";

const numbers: [string, Decimal, number | null][] = [
  ["1,234.50", ".", 1234.5], ["1.234,50", ",", 1234.5], ["229 402,18", ",", 229402.18], ["6.497,76 €", ",", 6497.76],
  ["-75,40", ",", -75.4], ["(45.00)", ".", -45], ["45.00-", ".", -45], ["$1,234.00", ".", 1234], ["1,200.00 CR", ".", 1200],
  ["120.00 DR", ".", -120], ["12.5%", ".", 12.5], ["15,0 %", ",", 15], ["¥61,051", ".", 61051], ["−3", ".", -3],
  ["1.234", ",", 1234], ["1.234", ".", 1.234], ["0,37", ",", 0.37], ["12 TL", ",", 12],
  ["GL-4000", ".", null], ["2026-01-10", ".", null], ["+1 555 0100", ".", null], ["-discount", ".", null], ["1,23,456", ".", null], ["-", ".", null], ["", ".", null],
];
for (const [s, d, want] of numbers) assert.equal(toNumber(s, d), want, `${s} (${d})`);

const dates: [string, "dmy" | "mdy", [number, number, number] | null][] = [
  ["14 Mar 2026", "dmy", [2026, 3, 14]], ["03/14/2026", "dmy", [2026, 3, 14]], ["14.03.2026", "mdy", [2026, 3, 14]],
  ["2026-03-14", "dmy", [2026, 3, 14]], ["March 14, 2026", "dmy", [2026, 3, 14]], ["14-Mar-26", "dmy", [2026, 3, 14]],
  ["04/05/2026", "mdy", [2026, 4, 5]], ["04/05/2026", "dmy", [2026, 5, 4]], ["14 Ekim 2026", "dmy", [2026, 10, 14]],
  ["31.02.2026", "dmy", null], ["Store 1", "dmy", null], ["12", "dmy", null],
];
for (const [s, o, want] of dates) assert.deepEqual(toDate(s, o), want, `${s} (${o})`);

assert.equal(decimalOf(["1.234,56", "0,37", "12"]), ",");
assert.equal(decimalOf(["1,234.56", "7"]), ".");
console.log("all value tests passed");
