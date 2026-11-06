import { TR } from "./tr.ts";

/** English is the key; Turkish texts are in tr.ts. {name} placeholders are filled in. */
export type Lang = "en" | "tr";

export let lang: Lang = (() => {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "tr" || q === "en") {
      localStorage.setItem("pdfx:lang", q);
      return q;
    }
    const saved = localStorage.getItem("pdfx:lang");
    if (saved === "tr" || saved === "en") return saved;
  } catch {}
  return typeof navigator !== "undefined" && /^tr\b/i.test(navigator.language) ? "tr" : "en";
})();

/** Text shown in Turkish without a translation; the end-to-end tests assert this stays empty. */
export const misses = new Set<string>();
if (typeof window !== "undefined") (window as unknown as { __i18nMisses: Set<string> }).__i18nMisses = misses;

export function t(s: string, vars?: Record<string, string | number>): string {
  let out = s;
  if (lang === "tr") {
    if (TR[s] !== undefined) out = TR[s];
    else if (/\p{L}/u.test(s)) misses.add(s);
  }
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** For text that may also be data (a sheet named after a column value): unknown text passes through. */
export const tKnown = (s: string) => (lang === "tr" && TR[s] !== undefined ? TR[s] : s);

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem("pdfx:lang", next);
  } catch {}
  applyStatic();
}

/** The page's own HTML text in the chosen language; the English original is kept on each element. */
export function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.dataset.en ??= el.textContent ?? "";
    el.textContent = t(el.dataset.en);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    el.dataset.en ??= el.innerHTML.trim();
    el.innerHTML = lang === "tr" && TR[el.dataset.en] ? TR[el.dataset.en] : el.dataset.en;
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    el.dataset.enPlaceholder ??= el.placeholder;
    el.placeholder = t(el.dataset.enPlaceholder);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    el.dataset.enAria ??= el.getAttribute("aria-label") ?? "";
    el.setAttribute("aria-label", t(el.dataset.enAria));
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.dataset.enTitle ??= el.getAttribute("title") ?? "";
    el.setAttribute("title", t(el.dataset.enTitle));
  });
  const btn = document.getElementById("lang");
  if (btn) {
    btn.querySelector("span")!.textContent = lang === "tr" ? "EN" : "TR";
    btn.setAttribute("aria-label", lang === "tr" ? "Switch to English" : "Türkçeye geç");
    btn.title = btn.getAttribute("aria-label")!;
  }
}
