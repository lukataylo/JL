import type { Employee, PolicyDoc, Transaction } from "./api";

/** Mirrors server Category. Order here is the fallback dial order. */
export const CATEGORIES = [
  "software", "hardware", "travel", "lodging", "transport", "meals", "books", "gifts", "repairs", "other",
  "gambling", "jewelry", "cash",
] as const;
export type Category = (typeof CATEGORIES)[number];

const FALLBACK_PROHIBITED: Category[] = ["gambling", "jewelry", "cash"];

export interface CategoryMeta {
  label: string;
  /** One line tied to a real policy rule. */
  hint: string;
  /** Clearance's first question once this category is picked. */
  opening: string;
  suggestions: string[];
  /** Index into the tint palette (1-4 = --tint-n, 5 = agent). */
  tint: 1 | 2 | 3 | 4 | 5;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  software: { label: "Software", tint: 2, hint: "Figma, GitHub, Notion, Linear, AWS and Vercel are approved vendors and clear fastest.",
    opening: "Which tool is it, and is it for you or the whole team?", suggestions: ["£45 Figma seat for the new designer", "£120 GitHub Copilot for the team", "£300 annual Linear plan"] },
  hardware: { label: "Hardware", tint: 4, hint: "Hardware over £500 needs manager pre-approval (P6). The normal route is IT procurement.",
    opening: "What are you buying, and why can't it go through IT procurement?", suggestions: ["£180 monitor, mine died this morning", "£65 laptop charger before a demo", "£900 replacement laptop"] },
  travel: { label: "Travel", tint: 1, hint: "British Airways and Eurostar are approved vendors.",
    opening: "Where are you headed, and is it for a client or an event?", suggestions: ["£148 Eurostar to Paris for KubeCon", "£320 flight to Berlin for a client", "£60 train to Manchester"] },
  lodging: { label: "Lodging", tint: 3, hint: "Lodging is tied to a trip. Say which city and how many nights.",
    opening: "Which city, and how many nights?", suggestions: ["£540 three nights in Paris for KubeCon", "£140 one night in Leeds", "£180 extra night, flight cancelled"] },
  transport: { label: "Transport", tint: 2, hint: "Uber is an approved vendor. Rides between midnight and 6am are reviewed (P7).",
    opening: "Taxi, rideshare or something else, and where to?", suggestions: ["£150 taxi home after the late client call", "£45 airport transfer", "£22 Uber to the client office"] },
  meals: { label: "Meals", tint: 3, hint: "Say who's eating and how many. Clearance funds meals per head.",
    opening: "Who's at the table, and how many of you?", suggestions: ["£60 client lunch today", "£240 team dinner for six", "£18 lunch on a travel day"] },
  books: { label: "Books", tint: 1, hint: "Books and courses for your work. Say what it's for.",
    opening: "What's the book or course, and how does it help your work?", suggestions: ["£40 Designing Data-Intensive Applications", "£120 online Rust course", "£25 audiobook for the commute"] },
  gifts: { label: "Gifts", tint: 4, hint: "Client gifts. Say who it's for and the occasion.",
    opening: "Who's it for, and what's the occasion?", suggestions: ["£50 thank-you gift for a client", "£35 leaving gift for a colleague", "£40 flowers for a client launch"] },
  repairs: { label: "Repairs", tint: 3, hint: "Emergency fixes to the office or work kit. Keep the receipt.",
    opening: "What needs fixing, and how urgent is it?", suggestions: ["£280 emergency plumber, office leak", "£90 phone screen repair", "£150 locksmith, office door jammed"] },
  other: { label: "Other", tint: 5, hint: "Anything else. Clearance works out which category it belongs to.",
    opening: "What do you need, and why now?", suggestions: ["£25 coworking day pass", "£95 visa fee for a client trip", "£40 parking at the client site"] },
  gambling: { label: "Gambling", tint: 5, hint: "Never allowed on company cards (P1).", opening: "", suggestions: [] },
  jewelry: { label: "Jewellery", tint: 5, hint: "Never allowed on company cards (P1).", opening: "", suggestions: [] },
  cash: { label: "Cash", tint: 5, hint: "Cash withdrawals are never allowed on company cards (P1).", opening: "", suggestions: [] },
};

export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

export type CategoryStatus = "ok" | "reason" | "blocked";

export function categoryStatus(c: Category, employee: Employee, policy: PolicyDoc | null): CategoryStatus {
  const prohibited = (policy?.policy.prohibitedCategories ?? FALLBACK_PROHIBITED) as string[];
  if (prohibited.includes(c)) return "blocked";
  const roleCats = policy?.policy.roles?.[employee.role]?.categories as string[] | undefined;
  if (!roleCats) return "ok";
  return roleCats.includes(c) ? "ok" : "reason";
}

/** Dial order: role categories, other allowed, `other`, then prohibited. */
export function dialOrder(employee: Employee, policy: PolicyDoc | null): Category[] {
  const rank = (c: Category) => {
    const s = categoryStatus(c, employee, policy);
    if (s === "blocked") return 3;
    if (c === "other") return 2;
    return s === "ok" ? 0 : 1;
  };
  return [...CATEGORIES].sort((a, b) => rank(a) - rank(b) || CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
}

/** Approved spend per category since the 1st of this month. */
export function spentThisMonth(transactions: Transaction[]): Partial<Record<Category, number>> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const out: Partial<Record<Category, number>> = {};
  for (const t of transactions) {
    if (t.status !== "approved" || !isCategory(t.category) || new Date(t.created_at) < start) continue;
    out[t.category] = (out[t.category] ?? 0) + (t.captured_amount ?? t.amount);
  }
  return out;
}
