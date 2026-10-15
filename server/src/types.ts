export type Role = "engineer" | "sales" | "finance";
export type Category =
  | "software" | "hardware" | "travel" | "lodging" | "transport" | "meals"
  | "books" | "gifts" | "repairs" | "gambling" | "jewelry" | "cash" | "other";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  monthly_budget: number; // minor units
  stripe_cardholder_id: string | null;
  avatar_color: string;
}

export interface Card {
  id: string;
  employee_id: string;
  stripe_card_id: string | null;
  last4: string;
  exp: string;
  status: "active" | "frozen";
  color: string;
  nickname: string;
}

/** A card authorization waiting for a decision — from Stripe or the local simulator. */
export interface AuthRequest {
  authorizationId: string;
  card: Card;
  employee: Employee;
  amount: number; // minor units
  currency: string;
  merchant: string;
  mcc: string; // Stripe merchant_data.category, e.g. "electronics_stores"
  city: string | null;
  at: Date;
}

export type RuleOutcome = "pass" | "flag" | "block" | "escalate" | "override";

export interface RuleResult {
  id: string;
  title: string;
  outcome: RuleOutcome;
  evidence: string;
}

export type Status = "approved" | "declined" | "escalated";
export type DecidedBy = "rules" | "agent" | "pre_approval" | "timeout_fallback" | "manager" | "negotiation" | "allowance";

export interface AgentVerdict {
  decision: "approve" | "decline" | "escalate";
  cited_rules: string[];
  summary: string;
  reasoning: string;
  risk_score: number;
}

export interface Transaction {
  id: string;
  stripe_authorization_id: string;
  card_id: string;
  employee_id: string;
  merchant: string;
  category: Category;
  mcc: string;
  city: string | null;
  amount: number;
  currency: string;
  status: Status;
  decided_by: DecidedBy;
  rule_results: RuleResult[];
  agent: AgentVerdict | null;
  summary: string;
  cited_rules: string[];
  latency_ms: number;
  created_at: string;
  /** Amount actually released to the merchant (may be lower after a negotiated counter). */
  captured_amount: number | null;
  released_by: string | null;
}

export type NegotiationOutcome = "ask" | "approve" | "counter" | "refer" | "deny";

export interface NegotiationMessage {
  role: "employee" | "agent";
  text: string;
  at: string;
  outcome?: NegotiationOutcome;
  counter_amount?: number | null;
  cited_rules?: string[];
}

export interface Negotiation {
  id: string;
  transaction_id: string;
  status: "open" | "approved" | "countered" | "accepted" | "referred" | "denied";
  messages: NegotiationMessage[];
  counter_amount: number | null;
  created_at: string;
}

export interface Approval {
  id: string;
  transaction_id: string;
  employee_id: string;
  merchant: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "used";
  approver: string | null;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
}
