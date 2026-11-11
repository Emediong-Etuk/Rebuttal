import type { Analysis, FactRecord } from "./schema";

/**
 * Deterministic ground-check. No model involved.
 *
 * A draft passes only if every rebuttal sentence cites at least one fact, every cited fact exists,
 * and every tracking number, date, amount or ID in the sentence appears in the facts it cites.
 * Rebuttal must never send PayPal a claim it cannot trace to a fetched record.
 */
export type GroundIssue = {
  sentence: number;
  code: "NO_CITATION" | "UNKNOWN_FACT" | "UNSUPPORTED_AMOUNT" | "UNSUPPORTED_DATE" | "UNSUPPORTED_IDENTIFIER";
  detail: string;
};

export type GroundCheckResult = { ok: boolean; issues: GroundIssue[]; checkedSentences: number };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Dates written in a sentence, normalised to YYYY-MM-DD. */
export function extractDates(text: string): { raw: string; iso: string }[] {
  const out: { raw: string; iso: string }[] = [];
  const push = (raw: string, y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ raw, iso: `${y}-${pad(m)}-${pad(d)}` });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g)) push(m[0], +m[1]!, +m[2]!, +m[3]!);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) push(m[0], +m[3]!, +m[1]!, +m[2]!); // US style M/D/YYYY
  const mon = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  for (const m of text.matchAll(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi")))
    push(m[0], +m[3]!, MONTHS[m[1]!.toLowerCase().slice(0, m[1]!.toLowerCase().startsWith("sept") ? 4 : 3)] ?? 0, +m[2]!);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}\\.?,?\\s+(\\d{4})\\b`, "gi")))
    push(m[0], +m[3]!, MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith("sept") ? 4 : 3)] ?? 0, +m[1]!);
  // Month and day without a year ("on November 3") still names a date that must be grounded.
  for (const m of text.matchAll(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s+\\d{4})`, "gi"))) {
    const month = MONTHS[m[1]!.toLowerCase().slice(0, m[1]!.toLowerCase().startsWith("sept") ? 4 : 3)] ?? 0;
    out.push({ raw: m[0], iso: `*-${pad(month)}-${pad(+m[2]!)}` });
  }
  return out;
}

/** Money amounts written in a sentence, normalised to two decimals. */
export function extractAmounts(text: string): { raw: string; value: string }[] {
  const out: { raw: string; value: string }[] = [];
  const re = /(?:(?:US)?\$|USD\s?|EUR\s?|GBP\s?|€|£)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(?:USD|EUR|GBP|dollars?)\b|\b(\d+\.\d{2})\b/gi;
  for (const m of text.matchAll(re)) {
    const num = (m[1] ?? m[2] ?? m[3] ?? "").replace(/,/g, "");
    if (num) out.push({ raw: m[0].trim(), value: Number(num).toFixed(2) });
  }
  return out;
}

/**
 * Identifier-like tokens: tracking numbers, transaction/capture/dispute IDs.
 * Any token of 8+ characters that contains a digit, plus PayPal's PP-/PP-D- style IDs.
 */
export function extractIdentifiers(text: string): string[] {
  const dates = new Set(extractDates(text).map((d) => d.raw));
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z0-9][A-Z0-9-]{6,}[A-Z0-9]\b/gi)) {
    const tok = m[0];
    if (!/\d/.test(tok)) continue;
    if (dates.has(tok) || /^\d{4}-\d{2}-\d{2}$/.test(tok)) continue;
    if (/^\d{1,3}(,\d{3})+$/.test(tok)) continue;
    out.add(tok);
  }
  return [...out];
}

function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (value == null) return acc;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") acc.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, acc));
  else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => collectStrings(v, acc));
  return acc;
}

type FactIndex = { text: string; dates: Set<string>; monthDays: Set<string>; amounts: Set<string> };

function indexFacts(facts: FactRecord[]): FactIndex {
  const strings = facts.flatMap((f) => collectStrings(f.data));
  const text = strings.join("\n").toUpperCase();
  const dates = new Set<string>();
  const monthDays = new Set<string>();
  const amounts = new Set<string>();
  for (const s of strings) {
    for (const d of extractDates(s)) {
      dates.add(d.iso);
      monthDays.add(d.iso.slice(4)); // "-MM-DD"
    }
    // Numeric values stored as plain strings, e.g. "value": "24.00".
    if (/^-?\d+(\.\d+)?$/.test(s.trim())) amounts.add(Number(s).toFixed(2));
    for (const a of extractAmounts(s)) amounts.add(a.value);
  }
  return { text, dates, monthDays, amounts };
}

export function groundCheck(analysis: Pick<Analysis, "rebuttal">, facts: FactRecord[]): GroundCheckResult {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const issues: GroundIssue[] = [];

  analysis.rebuttal.forEach((item, i) => {
    if (!item.fact_ids.length) {
      issues.push({ sentence: i, code: "NO_CITATION", detail: `Sentence ${i + 1} cites no facts.` });
      return;
    }
    const unknown = item.fact_ids.filter((id) => !byId.has(id));
    if (unknown.length) {
      issues.push({ sentence: i, code: "UNKNOWN_FACT", detail: `Sentence ${i + 1} cites unknown fact(s): ${unknown.join(", ")}.` });
      return;
    }
    const idx = indexFacts(item.fact_ids.map((id) => byId.get(id)!));

    for (const a of extractAmounts(item.sentence)) {
      if (!idx.amounts.has(a.value)) issues.push({ sentence: i, code: "UNSUPPORTED_AMOUNT", detail: `"${a.raw}" is not in the cited facts.` });
    }
    for (const d of extractDates(item.sentence)) {
      const ok = d.iso.startsWith("*") ? idx.monthDays.has(d.iso.slice(1)) : idx.dates.has(d.iso);
      if (!ok) issues.push({ sentence: i, code: "UNSUPPORTED_DATE", detail: `"${d.raw}" is not in the cited facts.` });
    }
    for (const tok of extractIdentifiers(item.sentence)) {
      if (!idx.text.includes(tok.toUpperCase())) issues.push({ sentence: i, code: "UNSUPPORTED_IDENTIFIER", detail: `"${tok}" is not in the cited facts.` });
    }
  });

  return { ok: issues.length === 0, issues, checkedSentences: analysis.rebuttal.length };
}
