export type Role = "engineer" | "sales" | "finance";
export type Status = "approved" | "declined" | "escalated";
export type DecidedBy = "rules" | "agent" | "pre_approval" | "timeout_fallback" | "manager" | "negotiation";

export interface Employee {
  id: string; name: string; email: string; role: Role; team: string;
  monthly_budget: number; avatar_color: string;
}
export interface Card {
  id: string; employee_id: string; stripe_card_id: string | null; last4: string; exp: string;
  status: "active" | "frozen"; color: string; nickname: string;
}
export interface RuleResult { id: string; title: string; outcome: "pass" | "flag" | "block" | "escalate" | "override"; evidence: string }
export interface AgentVerdict { decision: string; cited_rules: string[]; summary: string; reasoning: string; risk_score: number }
export interface Transaction {
  id: string; stripe_authorization_id: string; card_id: string; employee_id: string; merchant: string;
  category: string; mcc: string; city: string | null; amount: number; currency: string; status: Status;
  decided_by: DecidedBy; rule_results: RuleResult[]; agent: AgentVerdict | null; summary: string;
  cited_rules: string[]; latency_ms: number; created_at: string;
  /** Amount actually released (lower than `amount` after an accepted counter-offer). */
  captured_amount: number | null; released_by: string | null;
}
export type NegotiationOutcome = "ask" | "approve" | "counter" | "refer" | "deny";
export interface NegotiationMessage {
  role: "employee" | "agent"; text: string; at: string;
  outcome?: NegotiationOutcome; counter_amount?: number | null; cited_rules?: string[];
}
export interface Negotiation {
  id: string; transaction_id: string;
  /** open/countered = employee can keep talking; the rest are final. */
  status: "open" | "approved" | "countered" | "accepted" | "referred" | "denied";
  messages: NegotiationMessage[]; counter_amount: number | null; created_at: string;
}
export interface Approval {
  id: string; transaction_id: string; employee_id: string; merchant: string; amount: number; reason: string;
  status: "pending" | "approved" | "rejected" | "used"; approver: string | null; note: string | null;
  created_at: string; resolved_at: string | null;
}
export interface Overview { employee: Employee; cards: Card[]; transactions: Transaction[]; monthSpent: number; limit: number }
export interface Health { stripe: boolean; stripeMode: "issuing" | "payments" | "off"; agent: boolean; model: string; currency: string }
export interface PolicyDoc { policy: { company: string; version: string }; rules: { id: string; title: string; text: string }[] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export const api = {
  health: () => call<Health>("/health"),
  employees: () => call<Employee[]>("/employees"),
  overview: (id: string) => call<Overview>(`/employees/${id}/overview`),
  freeze: (cardId: string, frozen: boolean) => call<Card>(`/cards/${cardId}/freeze`, { method: "POST", body: JSON.stringify({ frozen }) }),
  approvals: () => call<Approval[]>("/approvals"),
  resolve: (id: string, action: "approve" | "reject", note?: string) =>
    call<Approval>(`/approvals/${id}`, { method: "POST", body: JSON.stringify({ action, note }) }),
  audit: () => call<Transaction[]>("/audit"),
  policy: () => call<PolicyDoc>("/policy"),
  negotiation: (txId: string) => call<Negotiation>(`/transactions/${txId}/negotiation`),
  /** Sends one employee message; Clearance replies (takes ~3-15s) and may settle the payment. */
  negotiate: (txId: string, message: string) =>
    call<{ negotiation: Negotiation; transaction: Transaction }>(`/transactions/${txId}/negotiation`, { method: "POST", body: JSON.stringify({ message }) }),
  acceptCounter: (txId: string) =>
    call<{ negotiation: Negotiation; transaction: Transaction }>(`/transactions/${txId}/negotiation`, { method: "POST", body: JSON.stringify({ accept: true }) }),
  simulate: (body: { cardId: string; merchant: string; mcc: string; amount: number; city?: string; hour?: number }) =>
    call<{ transaction?: Transaction }>("/simulate", { method: "POST", body: JSON.stringify(body) }),
};

export const money = (minor: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

export const CATEGORY_ICON: Record<string, string> = {
  software: "💻", hardware: "🖥️", travel: "✈️", lodging: "🏨", transport: "🚕", meals: "🍽️",
  books: "📚", gifts: "🎁", gambling: "🎰", jewelry: "💎", cash: "🏧", other: "🧾",
};

export const DECIDED_BY_LABEL: Record<DecidedBy, string> = {
  rules: "Policy engine",
  agent: "Clearance agent",
  pre_approval: "Manager pre-approval",
  timeout_fallback: "Safe default",
  manager: "Manager",
  negotiation: "Negotiated with Clearance",
};
