import type { Category, Role } from "./types.js";

/**
 * The company's written spend policy. Every rule has a stable ID so each decision can
 * cite the exact clause it relied on.
 */
export const POLICY = {
  company: "Acme Robotics Ltd",
  version: "v1 · 15 Oct 2026",
  currency: "gbp",
  roles: {
    engineer: { perTxnLimit: 50_000, categories: ["software", "hardware", "travel", "lodging", "transport", "meals", "books"] },
    sales: { perTxnLimit: 75_000, categories: ["software", "travel", "lodging", "transport", "meals", "gifts"] },
    finance: { perTxnLimit: 200_000, categories: ["software", "hardware", "travel", "lodging", "transport", "meals", "books", "gifts", "other"] },
  } satisfies Record<Role, { perTxnLimit: number; categories: Category[] }>,
  prohibitedCategories: ["gambling", "jewelry", "cash"] as Category[],
  approvedVendors: ["Figma", "GitHub", "Notion", "Linear", "AWS", "Vercel", "British Airways", "Eurostar", "Uber", "Pret A Manger"],
  hardwarePreApprovalOver: 50_000,
  newMerchantReviewOver: 10_000,
  hardBlockMultiple: 3,
  duplicateWindowMinutes: 15,
  quietHours: { from: 0, to: 6 }, // local hours, Europe/London
};

export const RULES = [
  { id: "P1", title: "Prohibited categories", text: "Gambling, jewellery and cash withdrawals are never allowed on company cards." },
  { id: "P2", title: "Role spend categories", text: "Each role may only spend in the categories listed for it. Anything else needs a reason." },
  { id: "P3", title: "Per-transaction limit", text: "Engineers £500, Sales £750, Finance £2,000 per payment. Over 3× the limit is always declined." },
  { id: "P4", title: "Monthly budget", text: "A payment that takes an employee over their monthly budget is declined." },
  { id: "P5", title: "Duplicate charges", text: "The same amount at the same merchant within 15 minutes is treated as a duplicate and declined." },
  { id: "P6", title: "Hardware pre-approval", text: "Hardware over £500 needs manager pre-approval. Normal route is IT procurement." },
  { id: "P7", title: "Out-of-hours spend", text: "Payments between 00:00 and 06:00 UK time are reviewed." },
  { id: "P8", title: "New merchants", text: "First-time merchants over £100 that are not approved vendors are reviewed." },
  { id: "P9", title: "Frozen cards", text: "Frozen cards decline every payment." },
  { id: "P10", title: "Manager pre-approval", text: "A manager's approval for a merchant and amount lets one matching payment through." },
  { id: "P11", title: "Funds first", text: "Cards hold £0. Spending needs funds released by Clearance or Finance for that purpose first." },
  { id: "P12", title: "Agreed purpose", text: "Released funds may only be spent in the category they were released for." },
] as const;

export type RuleId = (typeof RULES)[number]["id"];
export const ruleTitle = (id: RuleId) => RULES.find((r) => r.id === id)!.title;

/** Maps Stripe's merchant_data.category (MCC name) onto policy categories. */
export function categorize(mcc: string): Category {
  const m = mcc.toLowerCase();
  if (/gambling|betting|casino|lotter/.test(m)) return "gambling";
  if (/jewelry|jewellery|watch/.test(m)) return "jewelry";
  if (/cash_disburse|financial_institutions|quasi_cash|money_orders|wires/.test(m)) return "cash";
  if (/software|computer_network|data_processing|information_retrieval/.test(m)) return "software";
  if (/electronics|computers_peripherals|computer_.*stores|camera/.test(m)) return "hardware";
  if (/airline|air_carrier|railway|travel_agencies|bus_lines/.test(m)) return "travel";
  if (/hotel|motel|lodging|resort/.test(m)) return "lodging";
  if (/taxi|limousine|transportation|parking|car_rental/.test(m)) return "transport";
  if (/plumb|contractor|electrical|heating|roofing|carpentry|repair|locksmith|glass|cleaning/.test(m)) return "repairs";
  if (/restaurant|eating_places|fast_food|caterer|bakeries|drinking/.test(m)) return "meals";
  if (/book/.test(m)) return "books";
  if (/gift|florist|card_shops/.test(m)) return "gifts";
  return "other";
}

export const gbp = (minor: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
