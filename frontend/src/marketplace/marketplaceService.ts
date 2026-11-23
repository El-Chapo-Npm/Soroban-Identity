export interface Review {
  author: string;
  rating: number;
  comment: string;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  category: "template" | "service";
  priceUsd: number;
  seller: string;
  sellerRating: number;
  reviews: Review[];
  previewFields: Record<string, string>;
}

export interface CartItem {
  listing: Listing;
  quantity: number;
}

export interface Purchase {
  id: string;
  items: CartItem[];
  totalUsd: number;
  paymentIntentId: string;
  purchasedAt: string;
  status: "completed" | "refund_requested" | "refunded";
  refundReason?: string;
}

/** Payment gateway abstraction; a Stripe implementation can be plugged in via setPaymentGateway. */
export interface PaymentGateway {
  createPaymentIntent(amountCents: number, currency: string): Promise<{ id: string; clientSecret: string }>;
  confirmPayment(intentId: string): Promise<{ status: "succeeded" | "failed" }>;
  refund(intentId: string, reason: string): Promise<{ status: "pending" | "succeeded" }>;
}

export interface NotificationService {
  sendPurchaseConfirmation(email: string, purchase: Purchase): Promise<void>;
}

const API_BASE = (import.meta.env.VITE_MARKETPLACE_API as string | undefined) ?? "/api/marketplace";

/** Server-backed gateway: the backend owns secret keys and talks to Stripe. */
export const serverPaymentGateway: PaymentGateway = {
  async createPaymentIntent(amountCents, currency) {
    const res = await fetch(`${API_BASE}/payment-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountCents, currency }),
    });
    if (!res.ok) throw new Error("Failed to create payment intent");
    return res.json();
  },
  async confirmPayment(intentId) {
    const res = await fetch(`${API_BASE}/payment-intents/${encodeURIComponent(intentId)}/confirm`, { method: "POST" });
    if (!res.ok) throw new Error("Payment confirmation failed");
    return res.json();
  },
  async refund(intentId, reason) {
    const res = await fetch(`${API_BASE}/refunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentIntentId: intentId, reason }),
    });
    if (!res.ok) throw new Error("Refund request failed");
    return res.json();
  },
};

export const serverNotificationService: NotificationService = {
  async sendPurchaseConfirmation(email, purchase) {
    await fetch(`${API_BASE}/notifications/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purchaseId: purchase.id }),
    });
  },
};

let gateway: PaymentGateway = serverPaymentGateway;
let notifier: NotificationService = serverNotificationService;

export function setPaymentGateway(g: PaymentGateway) {
  gateway = g;
}
export function setNotificationService(n: NotificationService) {
  notifier = n;
}

export const SAMPLE_LISTINGS: Listing[] = [
  {
    id: "tpl-kyc",
    title: "KYC Credential Template",
    description: "Standard know-your-customer credential schema with selective disclosure fields.",
    category: "template",
    priceUsd: 49,
    seller: "VerifyLabs",
    sellerRating: 4.7,
    reviews: [{ author: "anchor.xlm", rating: 5, comment: "Dropped right into our issuer flow." }],
    previewFields: { fullName: "string", dateOfBirth: "date", country: "ISO-3166" },
  },
  {
    id: "tpl-edu",
    title: "Academic Degree Template",
    description: "Diploma credential with institution signature and graduation metadata.",
    category: "template",
    priceUsd: 29,
    seller: "EduChain",
    sellerRating: 4.4,
    reviews: [{ author: "uni-registrar", rating: 4, comment: "Solid, needed minor tweaks." }],
    previewFields: { degree: "string", institution: "DID", graduatedAt: "date" },
  },
  {
    id: "svc-audit",
    title: "Credential Issuance Audit",
    description: "Expert review of your issuer configuration and revocation strategy.",
    category: "service",
    priceUsd: 199,
    seller: "StellarSec",
    sellerRating: 4.9,
    reviews: [],
    previewFields: { deliverable: "PDF report", turnaround: "5 business days" },
  },
];

export async function fetchListings(): Promise<Listing[]> {
  try {
    const res = await fetch(`${API_BASE}/listings`);
    if (res.ok) return (await res.json()) as Listing[];
  } catch {
    // fall back to bundled sample listings when the API is unavailable
  }
  return SAMPLE_LISTINGS;
}

export function filterListings(
  listings: Listing[],
  { query = "", category = "all", maxPrice, minRating = 0 }: { query?: string; category?: string; maxPrice?: number; minRating?: number },
): Listing[] {
  const q = query.trim().toLowerCase();
  return listings.filter(
    (l) =>
      (!q || l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q) || l.seller.toLowerCase().includes(q)) &&
      (category === "all" || l.category === category) &&
      (maxPrice === undefined || l.priceUsd <= maxPrice) &&
      l.sellerRating >= minRating,
  );
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.listing.priceUsd * i.quantity, 0);
}

const HISTORY_KEY = "marketplace-purchases";

export function loadPurchaseHistory(): Purchase[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Purchase[];
  } catch {
    return [];
  }
}

function savePurchaseHistory(history: Purchase[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export async function checkout(items: CartItem[], email: string): Promise<Purchase> {
  if (!items.length) throw new Error("Cart is empty");
  const totalUsd = cartTotal(items);
  const intent = await gateway.createPaymentIntent(Math.round(totalUsd * 100), "usd");
  const result = await gateway.confirmPayment(intent.id);
  if (result.status !== "succeeded") throw new Error("Payment failed");
  const purchase: Purchase = {
    id: `pur_${Date.now()}`,
    items,
    totalUsd,
    paymentIntentId: intent.id,
    purchasedAt: new Date().toISOString(),
    status: "completed",
  };
  savePurchaseHistory([purchase, ...loadPurchaseHistory()]);
  if (email) await notifier.sendPurchaseConfirmation(email, purchase).catch(() => undefined);
  return purchase;
}

export async function requestRefund(purchaseId: string, reason: string): Promise<Purchase> {
  const history = loadPurchaseHistory();
  const purchase = history.find((p) => p.id === purchaseId);
  if (!purchase) throw new Error("Purchase not found");
  if (purchase.status !== "completed") throw new Error("Refund already requested");
  const result = await gateway.refund(purchase.paymentIntentId, reason);
  purchase.status = result.status === "succeeded" ? "refunded" : "refund_requested";
  purchase.refundReason = reason;
  savePurchaseHistory(history);
  return purchase;
}
