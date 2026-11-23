import { useEffect, useMemo, useState } from "react";
import {
  fetchListings,
  filterListings,
  cartTotal,
  checkout,
  requestRefund,
  loadPurchaseHistory,
  type Listing,
  type CartItem,
  type Purchase,
} from "./marketplaceService";

function Stars({ rating }: { rating: number }) {
  return <span aria-label={`${rating.toFixed(1)} out of 5 stars`}>{"★".repeat(Math.round(rating)).padEnd(5, "☆")}</span>;
}

export default function CredentialMarketplace() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [maxPrice, setMaxPrice] = useState<number | undefined>();
  const [minRating, setMinRating] = useState(0);
  const [preview, setPreview] = useState<Listing | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [email, setEmail] = useState("");
  const [history, setHistory] = useState<Purchase[]>(() => loadPurchaseHistory());
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchListings().then(setListings);
  }, []);

  const visible = useMemo(
    () => filterListings(listings, { query, category, maxPrice, minRating }),
    [listings, query, category, maxPrice, minRating],
  );

  const addToCart = (listing: Listing) =>
    setCart((c) => {
      const existing = c.find((i) => i.listing.id === listing.id);
      return existing
        ? c.map((i) => (i.listing.id === listing.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...c, { listing, quantity: 1 }];
    });

  const removeFromCart = (id: string) => setCart((c) => c.filter((i) => i.listing.id !== id));

  const handleCheckout = async () => {
    setBusy(true);
    setStatus("Processing payment…");
    try {
      const purchase = await checkout(cart, email);
      setCart([]);
      setHistory(loadPurchaseHistory());
      setStatus(`Purchase ${purchase.id} confirmed${email ? `; confirmation sent to ${email}` : ""}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRefund = async (id: string) => {
    const reason = window.prompt("Reason for refund?") ?? "";
    if (!reason) return;
    try {
      const p = await requestRefund(id, reason);
      setHistory(loadPurchaseHistory());
      setStatus(`Refund ${p.status === "refunded" ? "processed" : "requested"} for ${p.id}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Refund failed");
    }
  };

  return (
    <section aria-labelledby="marketplace-heading" className="marketplace">
      <h2 id="marketplace-heading">Credential Marketplace</h2>
      <p role="status" aria-live="polite">{status}</p>

      <form className="marketplace-filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label>
          Search
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Templates, services, sellers" />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All</option>
            <option value="template">Templates</option>
            <option value="service">Services</option>
          </select>
        </label>
        <label>
          Max price (USD)
          <input type="number" min={0} value={maxPrice ?? ""} onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : undefined)} />
        </label>
        <label>
          Min seller rating
          <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
            {[0, 3, 4, 4.5].map((r) => (
              <option key={r} value={r}>{r === 0 ? "Any" : `${r}+`}</option>
            ))}
          </select>
        </label>
      </form>

      <ul className="marketplace-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, listStyle: "none", padding: 0 }}>
        {visible.map((l) => (
          <li key={l.id} className="marketplace-card">
            <h3>{l.title}</h3>
            <p>{l.description}</p>
            <p>
              <strong>${l.priceUsd}</strong> · {l.category}
            </p>
            <p>
              Seller: {l.seller} <Stars rating={l.sellerRating} /> ({l.reviews.length} reviews)
            </p>
            <button type="button" onClick={() => setPreview(l)}>Preview</button>{" "}
            <button type="button" onClick={() => addToCart(l)}>Add to cart</button>
          </li>
        ))}
        {!visible.length && <li>No listings match your filters.</li>}
      </ul>

      {preview && (
        <div role="dialog" aria-modal="true" aria-labelledby="preview-heading" className="marketplace-preview">
          <h3 id="preview-heading">Preview: {preview.title}</h3>
          <dl>
            {Object.entries(preview.previewFields).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h4>Reviews</h4>
          {preview.reviews.length ? (
            <ul>
              {preview.reviews.map((r, i) => (
                <li key={i}>
                  <Stars rating={r.rating} /> {r.author}: {r.comment}
                </li>
              ))}
            </ul>
          ) : (
            <p>No reviews yet.</p>
          )}
          <button type="button" onClick={() => addToCart(preview)}>Add to cart</button>{" "}
          <button type="button" onClick={() => setPreview(null)}>Close</button>
        </div>
      )}

      <section aria-labelledby="cart-heading">
        <h3 id="cart-heading">Cart ({cart.length})</h3>
        <ul>
          {cart.map((i) => (
            <li key={i.listing.id}>
              {i.listing.title} × {i.quantity} — ${i.listing.priceUsd * i.quantity}{" "}
              <button type="button" onClick={() => removeFromCart(i.listing.id)} aria-label={`Remove ${i.listing.title}`}>Remove</button>
            </li>
          ))}
        </ul>
        <p>Total: ${cartTotal(cart)}</p>
        <label>
          Email for confirmation
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="button" disabled={!cart.length || busy} onClick={() => void handleCheckout()}>Secure checkout</button>
      </section>

      <section aria-labelledby="history-heading">
        <h3 id="history-heading">Purchase history</h3>
        {history.length ? (
          <ul>
            {history.map((p) => (
              <li key={p.id}>
                {new Date(p.purchasedAt).toLocaleString()} — {p.items.map((i) => i.listing.title).join(", ")} — ${p.totalUsd} — {p.status}{" "}
                {p.status === "completed" && (
                  <button type="button" onClick={() => void handleRefund(p.id)}>Request refund</button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No purchases yet.</p>
        )}
      </section>
    </section>
  );
}
