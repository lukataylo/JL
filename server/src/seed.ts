/**
 * Seeds demo employees, cards, history and company memory.
 *   npm run seed            → local data only
 *   npm run seed -- --stripe → also creates cardholders + virtual cards in Stripe test mode
 */
import "dotenv/config";
import { db, newId, repo } from "./db.js";
import "./funds.js";
import { CURRENCY, stripe } from "./stripe.js";
import { categorize } from "./policy.js";
import type { Card, Employee } from "./types.js";
import { pathToFileURL } from "node:url";

/** Wipes everything and loads the demo company. Also behind POST /api/demo/reset. */
export async function seedDemo(withStripe = false) {
if (withStripe && !stripe) throw new Error("Set STRIPE_SECRET_KEY (sk_test_...) to seed Stripe.");

db.exec("DELETE FROM employees; DELETE FROM cards; DELETE FROM transactions; DELETE FROM approvals; DELETE FROM memories; DELETE FROM negotiations; DELETE FROM fund_requests;");

const people: (Omit<Employee, "stripe_cardholder_id"> & { card: Pick<Card, "color" | "nickname"> })[] = [
  { id: "emp_maya", name: "Maya Chen", email: "maya@acme.test", role: "engineer", team: "Platform", monthly_budget: 200_000, avatar_color: "#7C5CFF", card: { color: "violet", nickname: "Platform team" } },
  { id: "emp_tom", name: "Tom Okafor", email: "tom@acme.test", role: "sales", team: "EMEA Sales", monthly_budget: 300_000, avatar_color: "#16C784", card: { color: "emerald", nickname: "Client travel" } },
  { id: "emp_priya", name: "Priya Shah", email: "priya@acme.test", role: "finance", team: "Finance", monthly_budget: 500_000, avatar_color: "#FF8A3D", card: { color: "sunset", nickname: "Finance" } },
];

for (const p of people) {
  let cardholderId: string | null = null;
  let stripeCardId: string | null = null;
  let last4 = String(1000 + Math.floor(Math.random() * 9000));
  let exp = "10/29";

  if (withStripe && stripe) {
    const [first, last] = p.name.split(" ");
    const cardholder = await stripe.issuing.cardholders.create({
      type: "individual",
      name: p.name,
      email: p.email,
      individual: {
        first_name: first,
        last_name: last,
        card_issuing: { user_terms_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" } },
      },
      billing: { address: { line1: "1 Example Street", city: "London", postal_code: "EC1A 1BB", country: "GB" } },
    });
    const card = await stripe.issuing.cards.create({ cardholder: cardholder.id, currency: CURRENCY, type: "virtual", status: "active" });
    cardholderId = cardholder.id;
    stripeCardId = card.id;
    last4 = card.last4;
    exp = `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`;
    console.log(`Stripe: ${p.name} → ${cardholder.id} / ${card.id}`);
  }

  db.prepare("INSERT INTO employees VALUES (?,?,?,?,?,?,?,?)").run(
    p.id, p.name, p.email, p.role, p.team, p.monthly_budget, cardholderId, p.avatar_color,
  );
  db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?)").run(
    newId("card"), p.id, stripeCardId, last4, exp, "active", p.card.color, p.card.nickname,
  );
}

// A few days of normal, approved history so the agent has patterns to compare against.
const history: [string, string, string, number, number][] = [
  ["emp_maya", "Figma", "computer_software_stores", 4_500, 9],
  ["emp_maya", "GitHub", "computer_software_stores", 8_400, 7],
  ["emp_maya", "AWS", "computer_network_services", 31_250, 4],
  ["emp_maya", "Pret A Manger", "eating_places_restaurants", 1_150, 1],
  ["emp_tom", "British Airways", "airlines_air_carriers", 42_000, 8],
  ["emp_tom", "The Ivy", "eating_places_restaurants", 38_400, 5],
  ["emp_tom", "Uber", "taxicabs_limousines", 2_350, 2],
];
for (const [employeeId, merchant, mcc, amount, daysAgo] of history) {
  const card = repo.cardsFor(employeeId)[0];
  repo.insertTransaction({
    id: newId("tx"), stripe_authorization_id: newId("iauth_seed"), card_id: card.id, employee_id: employeeId,
    merchant, category: categorize(mcc), mcc, city: "London", amount, currency: CURRENCY, status: "approved",
    decided_by: "rules", rule_results: [], agent: null, summary: "Approved: within policy.", cited_rules: [],
    latency_ms: 1, created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    captured_amount: amount, released_by: null,
  });
}

// Company memory: the context a good finance controller would know.
repo.addMemory("company", "Hardware is normally bought through IT procurement (Insight UK), not on personal cards.");
repo.addMemory("company", "Q4 offsite: Platform team is in Paris 20–23 Oct 2026 for KubeCon EU.");
repo.addMemory("emp_maya", "Maya is speaking at KubeCon EU in Paris (20–23 Oct 2026). Travel and lodging pre-cleared by Priya Shah.");
repo.addMemory("emp_tom", "Tom is closing the Northwind deal; client dinners up to £150 per head approved by the Sales VP.");
repo.addMemory("emp_tom", "Tom has a history of late-night client entertainment receipts being queried by finance.");

console.log(`Seeded ${people.length} employees${withStripe ? " with Stripe test-mode cards" : " (local cards)"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await seedDemo(process.argv.includes("--stripe"));
