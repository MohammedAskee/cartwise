import { storage } from "../lib/storage.js";
import {
  auth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "../lib/firebase.js";
import {
  CURRENCIES,
  formatMoney,
  lineTotal,
  derivePrices,
  suggestPurchases,
} from "../lib/money.js";
import { compressImage } from "../lib/image.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let currentUser = null;
let busy = false;

function toast(message, type = "success") {
  const host = $("#toast-host");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function thumbHtml(src, cls = "thumb") {
  if (src) return `<img class="${cls}" src="${escapeHtml(src)}" alt="" />`;
  return `<div class="${cls} thumb-placeholder" aria-hidden="true">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  </div>`;
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "") || "home";
  const [page, id] = hash.split("/");
  return { page, id: id || null };
}

function navigate(to) {
  location.hash = to.startsWith("#") ? to : `#/${to}`;
}

function budgetMeterHtml(spent, budget, currency) {
  const remaining = budget - spent;
  const over = remaining < 0;
  const tight = !over && budget > 0 && remaining / budget <= 0.12;
  const ratio = budget > 0 ? Math.min(spent / budget, 1) : spent > 0 ? 1 : 0;
  const fillClass = over ? "over" : tight ? "tight" : "";
  const remClass = over ? "text-danger" : tight ? "text-warn" : "text-success";
  return `
    <div class="budget-meter">
      <div class="budget-row">
        <div>
          <p class="budget-label">${over ? "Over budget" : "Spent"}</p>
          <p class="budget-value">${formatMoney(spent, currency)}</p>
        </div>
        <div style="text-align:right">
          <p class="budget-label">${over ? "Over by" : "Left"}</p>
          <p class="budget-value sm ${remClass}">${formatMoney(Math.abs(remaining), currency)}</p>
        </div>
      </div>
      <div class="budget-bar"><div class="budget-fill ${fillClass}" style="width:${Math.max(2, ratio * 100)}%"></div></div>
      <p class="text-muted" style="font-size:0.75rem;margin:0">${
        budget > 0 ? `Budget ${formatMoney(budget, currency)}` : "No budget set"
      }</p>
    </div>`;
}

function renderShell(content, activeNav) {
  const name = currentUser?.displayName || currentUser?.email || "Account";
  const root = $("#app");
  root.innerHTML = `
    <header class="app-header">
      <div class="app-header-inner">
        <a href="#/home" class="wordmark">Cartwise <span>Shop ledger</span></a>
        <nav class="nav">
          <a href="#/home" class="${activeNav === "home" ? "active" : ""}">Lists</a>
          <a href="#/catalog" class="${activeNav === "catalog" ? "active" : ""}">Catalog</a>
        </nav>
        <div class="header-tools">
          <button type="button" class="btn btn-ghost btn-sm" id="btn-export" title="Export backup">Export</button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-signout" title="${escapeHtml(name)}">Sign out</button>
        </div>
      </div>
    </header>
    <main class="main">${content}</main>`;
  $("#btn-export")?.addEventListener("click", onExport);
  $("#btn-signout")?.addEventListener("click", async () => {
    await signOut(auth);
    toast("Signed out");
  });
}

function renderAuth() {
  const root = $("#app");
  root.innerHTML = `
    <main class="main" style="max-width:28rem;padding-top:3rem">
      <div style="text-align:center;margin-bottom:1.5rem">
        <p class="wordmark" style="font-size:2rem;margin:0">Cartwise</p>
        <p class="text-muted mt-2" style="margin:0.5rem 0 0">Shop with a budget, not a guess.</p>
      </div>
      <div class="card">
        <div class="segment mb-4" id="auth-tabs">
          <button type="button" data-mode="signin" class="active">Sign in</button>
          <button type="button" data-mode="signup">Create account</button>
        </div>
        <form id="auth-form" class="stack">
          <div class="field signup-only hidden">
            <label for="auth-name">Name</label>
            <input class="input" id="auth-name" autocomplete="name" placeholder="Alex" />
          </div>
          <div class="field">
            <label for="auth-email">Email</label>
            <input class="input" id="auth-email" type="email" required autocomplete="email" placeholder="you@example.com" />
          </div>
          <div class="field">
            <label for="auth-password">Password</label>
            <input class="input" id="auth-password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters" />
          </div>
          <p id="auth-error" class="text-danger" style="font-size:0.875rem;margin:0;display:none"></p>
          <button type="submit" class="btn btn-primary" id="auth-submit" style="width:100%">Sign in</button>
        </form>
      </div>
      <p class="text-muted" style="font-size:0.8125rem;text-align:center;margin-top:1.25rem">
        Your lists sync via Firebase. Enable Email/Password in Authentication and paste the Firestore rules from README.
      </p>
    </main>`;

  let mode = "signin";
  const setMode = (m) => {
    mode = m;
    $$("#auth-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    $$(".signup-only").forEach((el) => el.classList.toggle("hidden", mode !== "signup"));
    $("#auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
    $("#auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  };
  $$("#auth-tabs button").forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const err = $("#auth-error");
    err.style.display = "none";
    const btn = $("#auth-submit");
    btn.disabled = true;
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const name = $("#auth-name").value.trim();
        if (name) await updateProfile(cred.user, { displayName: name });
        toast("Account created");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast("Welcome back");
      }
    } catch (ex) {
      err.textContent = friendlyAuthError(ex);
      err.style.display = "block";
    } finally {
      btn.disabled = false;
    }
  });
}

function friendlyAuthError(ex) {
  const code = ex?.code || "";
  if (code.includes("email-already-in-use")) return "That email is already registered. Sign in instead.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential"))
    return "Wrong email or password.";
  if (code.includes("too-many-requests")) return "Too many attempts. Try again later.";
  return ex?.message || "Could not sign in.";
}

async function renderHome() {
  let trips = [];
  try {
    trips = await storage.listTrips();
  } catch (e) {
    toast(e.message || "Could not load lists", "error");
  }
  const open = trips.filter((t) => t.status === "open");
  const done = trips.filter((t) => t.status === "done");
  const featured = open[0];

  let body = "";
  if (!trips.length) {
    body = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Your till</p>
          <h1>Shopping lists</h1>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-outline" id="btn-add-product">Add product</button>
          <button type="button" class="btn btn-primary" id="btn-new-trip">New list</button>
        </div>
      </div>
      <div class="card empty">
        <h2>No lists yet</h2>
        <p>Start a shopping list with a budget, or load a sample shop to see item vs box pricing.</p>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" id="btn-new-trip-2">Create a list</button>
          <button type="button" class="btn btn-outline" id="btn-seed">Try a sample shop</button>
        </div>
      </div>`;
  } else {
    body = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Your till</p>
          <h1>Shopping lists</h1>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-outline" id="btn-add-product">Add product</button>
          <button type="button" class="btn btn-primary" id="btn-new-trip">New list</button>
        </div>
      </div>`;
    if (featured) {
      body += `
        <a href="#/trip/${featured.id}" class="card trip-card card-hover mb-4" style="display:block">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start">
            <div>
              <p class="eyebrow">Active list</p>
              <h2>${escapeHtml(featured.name)}</h2>
            </div>
            <span class="badge">${featured.itemCount} items</span>
          </div>
          <div class="mt-4">${budgetMeterHtml(featured.spent, featured.budget, featured.currency)}</div>
          <p class="mt-3" style="font-size:0.875rem;font-weight:500;margin:0">Open list →</p>
        </a>`;
    }
    if (open.length > 1) {
      body += `<p class="section-label">Other open lists</p><div class="stack">`;
      open.slice(1).forEach((t) => {
        body += tripCardHtml(t);
      });
      body += `</div>`;
    }
    if (done.length) {
      body += `<p class="section-label">Done</p><div class="stack">`;
      done.forEach((t) => {
        body += tripCardHtml(t);
      });
      body += `</div>`;
    }
  }

  renderShell(body, "home");
  $("#btn-new-trip")?.addEventListener("click", () => openTripModal());
  $("#btn-new-trip-2")?.addEventListener("click", () => openTripModal());
  $("#btn-add-product")?.addEventListener("click", () => openProductModal());
  $("#btn-seed")?.addEventListener("click", async () => {
    try {
      const id = await storage.seedSample();
      toast("Sample list ready — try changing candy from 5 items to a box.");
      navigate(`trip/${id}`);
    } catch (e) {
      toast(e.message || "Could not seed sample", "error");
    }
  });
}

function tripCardHtml(t) {
  return `
    <a href="#/trip/${t.id}" class="card trip-card card-hover">
      <div style="display:flex;justify-content:space-between;gap:0.5rem">
        <h2 style="font-size:1.2rem">${escapeHtml(t.name)}</h2>
        ${t.status === "done" ? `<span class="badge">Done</span>` : ""}
      </div>
      <p class="text-muted tabular mt-2" style="font-size:0.875rem;margin:0">
        ${formatMoney(t.spent, t.currency)} of ${formatMoney(t.budget, t.currency)} · ${t.itemCount} items
      </p>
    </a>`;
}

async function renderCatalog() {
  let products = [];
  try {
    products = await storage.listProducts();
  } catch (e) {
    toast(e.message || "Could not load catalog", "error");
  }
  let body = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Shelf</p>
        <h1>Catalog</h1>
        <p class="text-muted mt-1" style="font-size:0.875rem;max-width:28rem;margin-top:0.35rem">
          Save products once. Add by hand with prices for a single piece and a box, then reuse on any list.
        </p>
      </div>
      <button type="button" class="btn btn-primary" id="btn-add-product">Add product</button>
    </div>
    <div class="paste-bar">
      <div class="input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <input class="input" id="paste-url" placeholder="Paste a product page URL (optional)" />
      </div>
      <button type="button" class="btn btn-secondary" id="btn-fetch-url">Fetch</button>
    </div>`;

  if (!products.length) {
    body += `
      <div class="card empty">
        <h2>Your shelf is empty</h2>
        <p>Add a product with item and box prices so Cartwise can compare “5 pieces” vs “1 box”.</p>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" id="btn-add-product-2">Add your first product</button>
        </div>
      </div>`;
  } else {
    body += `<div class="product-grid">`;
    products.forEach((p) => {
      const badges = [];
      if (p.pricePerItem > 0) badges.push(`<span class="badge">${formatMoney(p.pricePerItem)} / item</span>`);
      if (p.pricePerBox > 0) badges.push(`<span class="badge">${formatMoney(p.pricePerBox)} / box</span>`);
      if (p.pcsPerBox) badges.push(`<span class="badge badge-accent">${p.pcsPerBox} pcs / box</span>`);
      body += `
        <div class="card product-card" data-id="${p.id}">
          <div class="product-card-top">
            ${thumbHtml(p.imageUrl)}
            <div style="min-width:0;flex:1">
              <h2 style="font-size:1rem;font-family:var(--font);font-weight:600;letter-spacing:0">${escapeHtml(p.name)}</h2>
              ${p.description ? `<p class="text-muted mt-1" style="font-size:0.8125rem;margin:0.25rem 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(p.description)}</p>` : ""}
              <div class="flex-gap mt-2">${badges.join("")}</div>
            </div>
          </div>
          <div class="flex-gap" style="margin-top:auto">
            <button type="button" class="btn btn-primary btn-sm flex-1 btn-add-list" style="flex:1">Add to list</button>
            <button type="button" class="btn btn-outline btn-sm btn-icon btn-edit" title="Edit">✎</button>
            <button type="button" class="btn btn-outline btn-sm btn-icon btn-del" title="Delete">✕</button>
          </div>
        </div>`;
    });
    body += `</div>`;
  }

  renderShell(body, "catalog");
  $("#btn-add-product")?.addEventListener("click", () => openProductModal());
  $("#btn-add-product-2")?.addEventListener("click", () => openProductModal());
  $("#btn-fetch-url")?.addEventListener("click", () => {
    const url = $("#paste-url")?.value.trim();
    openProductModal({ sourceUrl: url || "" });
    if (url) tryFetchUrl(url);
  });
  $$(".product-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector(".btn-add-list")?.addEventListener("click", () => openAddToTrip(id));
    card.querySelector(".btn-edit")?.addEventListener("click", async () => {
      const p = await storage.getProduct(id);
      openProductModal(p);
    });
    card.querySelector(".btn-del")?.addEventListener("click", async () => {
      if (!confirm("Remove this product from the catalog?")) return;
      await storage.deleteProduct(id);
      toast("Removed from catalog");
      renderCatalog();
    });
  });
}

async function renderTrip(tripId) {
  let detail;
  try {
    detail = await storage.getTrip(tripId);
  } catch (e) {
    toast(e.message || "Could not load list", "error");
  }
  if (!detail) {
    renderShell(
      `<div class="card empty"><h2>List not found</h2><a class="btn btn-primary mt-4" href="#/home">Back to lists</a></div>`,
      "home",
    );
    return;
  }
  const { trip, items } = detail;
  const remaining = items.filter((i) => !i.checked);
  const got = items.filter((i) => i.checked);
  const shopMode = sessionStorage.getItem(`cartwise.shop.${tripId}`) === "1";

  let body = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.75rem">
      <a href="#/home" class="back-link">← Lists</a>
      <div class="flex-gap">
        <button type="button" class="btn ${shopMode ? "btn-accent" : "btn-outline"} btn-sm" id="btn-shop">${shopMode ? "Exit shop mode" : "Shop mode"}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-status">${trip.status === "open" ? "Mark done" : "Reopen"}</button>
      </div>
    </div>
    <div class="mt-3 mb-4">
      ${trip.status === "done" ? `<span class="badge mb-2">Done</span>` : ""}
      <h1>${escapeHtml(trip.name)}</h1>
      <p class="text-muted mt-1" style="font-size:0.875rem;margin:0.25rem 0 0">${items.length} items · ${got.length} ticked</p>
    </div>
    <div class="card mb-4">
      ${budgetMeterHtml(trip.spent, trip.budget, trip.currency)}
      ${
        !shopMode
          ? `<form id="budget-form" class="flex-gap mt-4" style="align-items:flex-end">
              <div class="field" style="width:9rem">
                <label for="budget-input">Edit budget</label>
                <input class="input" id="budget-input" inputmode="decimal" value="${trip.budget}" />
              </div>
              <button type="submit" class="btn btn-secondary btn-sm">Save budget</button>
            </form>`
          : ""
      }
    </div>`;

  if (!shopMode) {
    body += `
      <div class="flex-gap mb-4">
        <button type="button" class="btn btn-primary" id="btn-from-catalog">From catalog</button>
        <button type="button" class="btn btn-outline" id="btn-new-product">New product</button>
      </div>
      <div id="catalog-picker" class="card mb-4 hidden">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Pick from catalog</strong>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-close-picker">Close</button>
        </div>
        <div id="catalog-picker-list" class="stack mt-3"></div>
      </div>`;
  }

  body += `<div class="stack" id="item-list">`;
  if (!items.length) {
    body += `<div class="card empty"><h2>Nothing on this list yet</h2><p>Add from your catalog, or save a new product and drop it straight in.</p></div>`;
  }
  remaining.forEach((it) => {
    body += itemRowHtml(it, trip.currency, shopMode);
  });
  body += `</div>`;

  if (got.length) {
    body += `<p class="section-label">In the basket</p><div class="stack">`;
    got.forEach((it) => {
      body += itemRowHtml(it, trip.currency, shopMode);
    });
    body += `</div>`;
  }

  if (!shopMode) {
    body += `
      <div style="margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--border)">
        <button type="button" class="btn btn-danger" id="btn-delete-trip">Delete list</button>
      </div>`;
  }

  renderShell(body, "home");

  $("#btn-shop")?.addEventListener("click", () => {
    sessionStorage.setItem(`cartwise.shop.${tripId}`, shopMode ? "0" : "1");
    renderTrip(tripId);
  });
  $("#btn-status")?.addEventListener("click", async () => {
    await storage.saveTrip({
      id: tripId,
      name: trip.name,
      budget: trip.budget,
      currency: trip.currency,
      status: trip.status === "open" ? "done" : "open",
    });
    toast(trip.status === "open" ? "List marked done" : "List reopened");
    renderTrip(tripId);
  });
  $("#budget-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const budget = Number($("#budget-input").value);
    await storage.saveTrip({ id: tripId, name: trip.name, budget, currency: trip.currency, status: trip.status });
    toast("Budget updated");
    renderTrip(tripId);
  });
  $("#btn-from-catalog")?.addEventListener("click", () => showCatalogPicker(tripId));
  $("#btn-close-picker")?.addEventListener("click", () => $("#catalog-picker")?.classList.add("hidden"));
  $("#btn-new-product")?.addEventListener("click", () => {
    openProductModal(null, (product) => openAddToTrip(product.id, tripId));
  });
  $("#btn-delete-trip")?.addEventListener("click", async () => {
    if (!confirm("Delete this list and its items?")) return;
    await storage.deleteTrip(tripId);
    toast("List deleted");
    navigate("home");
  });

  $$(".item-row").forEach((row) => bindItemRow(row, tripId));
}

function itemRowHtml(it, currency, shopMode) {
  const total = lineTotal({
    unit: it.unit,
    quantity: it.quantity,
    pricePerItem: it.pricePerItem,
    pricePerBox: it.pricePerBox,
  });
  const unitPrice = it.unit === "box" ? it.pricePerBox : it.pricePerItem;
  return `
    <article class="card item-row ${it.checked ? "checked" : ""}" data-id="${it.id}">
      <input type="checkbox" class="checkbox ${shopMode ? "lg" : ""} item-check" ${it.checked ? "checked" : ""} aria-label="Got ${escapeHtml(it.name)}" />
      ${thumbHtml(it.imageUrl)}
      <div class="item-body">
        <div class="item-top">
          <div>
            <h3 style="font-size:1rem;font-family:var(--font);font-weight:600;letter-spacing:0;margin:0">${escapeHtml(it.name)}</h3>
            ${it.pcsPerBox ? `<p class="text-muted" style="font-size:0.75rem;margin:0">${it.pcsPerBox} pcs / box</p>` : ""}
          </div>
          <p class="tabular" style="font-family:var(--display);font-size:1.125rem;font-weight:500;margin:0">${formatMoney(total, currency)}</p>
        </div>
        ${
          shopMode
            ? `<p class="text-muted tabular" style="font-size:0.875rem;margin:0">${it.quantity} ${it.unit}${it.quantity === 1 ? "" : "s"} · ${formatMoney(unitPrice, currency)} each</p>`
            : `<div class="item-controls">
                <div class="flex-gap">
                  <div class="segment item-unit" style="width:9rem">
                    <button type="button" data-unit="item" class="${it.unit === "item" ? "active" : ""}">Item</button>
                    <button type="button" data-unit="box" class="${it.unit === "box" ? "active" : ""}">Box</button>
                  </div>
                  <div class="stepper">
                    <button type="button" class="qty-dec" aria-label="Decrease">−</button>
                    <input type="number" min="1" class="qty-input" value="${it.quantity}" />
                    <button type="button" class="qty-inc" aria-label="Increase">+</button>
                  </div>
                </div>
                <div class="flex-gap">
                  <span class="text-muted tabular" style="font-size:0.75rem">${formatMoney(unitPrice, currency)} / ${it.unit}</span>
                  <button type="button" class="btn btn-ghost btn-sm btn-icon item-del" aria-label="Remove">🗑</button>
                </div>
              </div>`
        }
      </div>
    </article>`;
}

function bindItemRow(row, tripId) {
  const id = row.dataset.id;
  row.querySelector(".item-check")?.addEventListener("change", async (e) => {
    await storage.updateItem(id, { checked: e.target.checked });
    renderTrip(tripId);
  });
  row.querySelectorAll(".item-unit button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await storage.updateItem(id, { unit: btn.dataset.unit });
      renderTrip(tripId);
    });
  });
  const qtyInput = row.querySelector(".qty-input");
  row.querySelector(".qty-dec")?.addEventListener("click", async () => {
    const n = Math.max(1, (Number(qtyInput.value) || 1) - 1);
    await storage.updateItem(id, { quantity: n });
    renderTrip(tripId);
  });
  row.querySelector(".qty-inc")?.addEventListener("click", async () => {
    const n = (Number(qtyInput.value) || 1) + 1;
    await storage.updateItem(id, { quantity: n });
    renderTrip(tripId);
  });
  qtyInput?.addEventListener("change", async () => {
    await storage.updateItem(id, { quantity: Number(qtyInput.value) || 1 });
    renderTrip(tripId);
  });
  row.querySelector(".item-del")?.addEventListener("click", async () => {
    await storage.deleteItem(id);
    toast("Item removed");
    renderTrip(tripId);
  });
}

async function showCatalogPicker(tripId) {
  const panel = $("#catalog-picker");
  const list = $("#catalog-picker-list");
  let products = [];
  try {
    products = await storage.listProducts();
  } catch (e) {
    toast(e.message || "Could not load catalog", "error");
    return;
  }
  if (!products.length) {
    toast("Catalog is empty — add a product first.", "error");
    return;
  }
  panel.classList.remove("hidden");
  list.innerHTML = products
    .map(
      (p) => `
    <button type="button" class="option-btn pick-product" data-id="${p.id}">
      <span style="font-weight:500">${escapeHtml(p.name)}</span>
      <span class="text-muted tabular" style="font-size:0.875rem">${
        p.pricePerItem > 0 ? formatMoney(p.pricePerItem) : formatMoney(p.pricePerBox)
      }</span>
    </button>`,
    )
    .join("");
  $$(".pick-product", list).forEach((btn) => {
    btn.addEventListener("click", () => {
      panel.classList.add("hidden");
      openAddToTrip(btn.dataset.id, tripId);
    });
  });
}

function openModal(html) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modal-root";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

function closeModal() {
  $("#modal-root")?.remove();
}

function openTripModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <h2>New shopping list</h2>
        <p class="modal-desc">Set a budget first. Every item you add will count against it.</p>
      </div>
      <button type="button" class="modal-close" data-close>×</button>
    </div>
    <form id="trip-form" class="stack">
      <div class="field">
        <label for="trip-name">Name</label>
        <input class="input" id="trip-name" value="Weekly shop" required />
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="trip-budget">Budget</label>
          <input class="input" id="trip-budget" inputmode="decimal" value="80" />
        </div>
        <div class="field">
          <label for="trip-currency">Currency</label>
          <select class="select" id="trip-currency">
            ${CURRENCIES.map((c) => `<option value="${c.code}">${c.code}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Create list</button>
      </div>
    </form>`);
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  $("#trip-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const trip = await storage.saveTrip({
        name: $("#trip-name").value.trim() || "Shopping list",
        budget: Number($("#trip-budget").value) || 0,
        currency: $("#trip-currency").value,
      });
      closeModal();
      navigate(`trip/${trip.id}`);
    } catch (err) {
      toast(err.message || "Could not create list", "error");
    }
  });
}

function openProductModal(existing = null, onSaved = null) {
  const p = existing || {};
  openModal(`
    <div class="modal-header">
      <div>
        <h2>${existing ? "Edit product" : "Add to catalog"}</h2>
        <p class="modal-desc">Set how it is sold — by the piece or by the box — so lists can compare both.</p>
      </div>
      <button type="button" class="modal-close" data-close>×</button>
    </div>
    <form id="product-form" class="stack">
      <div class="field">
        <label for="p-url">Product link (optional)</label>
        <div class="flex-gap">
          <input class="input" id="p-url" style="flex:1" placeholder="https://…" value="${escapeHtml(p.sourceUrl || "")}" />
          <button type="button" class="btn btn-secondary" id="p-fetch">Fetch</button>
        </div>
      </div>
      <div class="flex-gap">
        <div id="p-thumb-wrap">${thumbHtml(p.imageUrl || null)}</div>
        <div>
          <input type="file" id="p-file" accept="image/*" class="hidden" />
          <button type="button" class="btn btn-outline btn-sm" id="p-upload">${p.imageUrl ? "Replace image" : "Upload image"}</button>
        </div>
      </div>
      <input type="hidden" id="p-image" value="${escapeHtml(p.imageUrl || "")}" />
      <div class="field">
        <label for="p-name">Name</label>
        <input class="input" id="p-name" required value="${escapeHtml(p.name || "")}" placeholder="Sour candy belts" />
      </div>
      <div class="field">
        <label for="p-desc">Notes</label>
        <textarea class="textarea" id="p-desc" placeholder="Flavour, size, aisle…">${escapeHtml(p.description || "")}</textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="p-item">Price per item</label>
          <input class="input" id="p-item" inputmode="decimal" value="${p.pricePerItem || ""}" placeholder="0.45" />
        </div>
        <div class="field">
          <label for="p-box">Price per box</label>
          <input class="input" id="p-box" inputmode="decimal" value="${p.pricePerBox || ""}" placeholder="3.99" />
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="p-pcs">Pieces per box</label>
          <input class="input" id="p-pcs" inputmode="numeric" value="${p.pcsPerBox || ""}" placeholder="10" />
        </div>
        <div class="field">
          <label>Default unit</label>
          <div class="segment" id="p-unit">
            <button type="button" data-unit="item" class="${(p.defaultUnit || "item") === "item" ? "active" : ""}">Item</button>
            <button type="button" data-unit="box" class="${p.defaultUnit === "box" ? "active" : ""}">Box</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Save product</button>
      </div>
    </form>`);

  let defaultUnit = p.defaultUnit === "box" ? "box" : "item";
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  $$("#p-unit button").forEach((btn) => {
    btn.addEventListener("click", () => {
      defaultUnit = btn.dataset.unit;
      $$("#p-unit button").forEach((b) => b.classList.toggle("active", b.dataset.unit === defaultUnit));
    });
  });
  $("#p-upload").addEventListener("click", () => $("#p-file").click());
  $("#p-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await compressImage(file);
      $("#p-image").value = data;
      $("#p-thumb-wrap").innerHTML = thumbHtml(data);
    } catch (err) {
      toast(err.message || "Could not use that image", "error");
    }
  });
  $("#p-fetch").addEventListener("click", () => tryFetchUrl($("#p-url").value.trim()));
  $("#product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#p-name").value.trim();
    if (!name) return toast("Give this product a name.", "error");
    const prices = derivePrices({
      pricePerItem: $("#p-item").value === "" ? null : Number($("#p-item").value),
      pricePerBox: $("#p-box").value === "" ? null : Number($("#p-box").value),
      pcsPerBox: $("#p-pcs").value === "" ? null : Number($("#p-pcs").value),
    });
    try {
      const product = await storage.saveProduct({
        id: p.id,
        name,
        description: $("#p-desc").value.trim(),
        sourceUrl: $("#p-url").value.trim() || null,
        imageUrl: $("#p-image").value || null,
        pricePerItem: prices.pricePerItem,
        pricePerBox: prices.pricePerBox,
        pcsPerBox: $("#p-pcs").value ? Number($("#p-pcs").value) : null,
        defaultUnit,
      });
      closeModal();
      toast(existing ? "Product updated" : "Saved to catalog");
      if (onSaved) onSaved(product);
      else {
        const { page, id } = parseRoute();
        if (page === "catalog") renderCatalog();
        else if (page === "trip" && id) renderTrip(id);
        else renderHome();
      }
    } catch (err) {
      toast(err.message || "Could not save product", "error");
    }
  });
}

function decodeEntities(s) {
  if (!s) return "";
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value.replace(/\s+/g, " ").trim();
}

function parseJsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const type = node["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.some((t) => /Product/i.test(String(t || "")))) out.push(node);
      }
    } catch {
      /* ignore bad JSON-LD */
    }
  }
  return out;
}

function priceFromOffers(offers) {
  if (!offers) return "";
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o) continue;
    const p = o.price ?? o.lowPrice ?? o.highPrice;
    if (p != null && p !== "") return String(p);
  }
  return "";
}

function extractProductFromHtml(html) {
  const meta = (prop) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      "i",
    );
    return html.match(re)?.[1] || html.match(re2)?.[1] || "";
  };

  const jsonLd = parseJsonLdProducts(html)[0];
  let title =
    (jsonLd && (jsonLd.name || jsonLd.title)) ||
    meta("og:title") ||
    meta("twitter:title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    "";
  let desc =
    (jsonLd && (jsonLd.description || jsonLd.about)) ||
    meta("og:description") ||
    meta("description") ||
    meta("twitter:description") ||
    "";
  let image =
    (jsonLd &&
      (typeof jsonLd.image === "string"
        ? jsonLd.image
        : Array.isArray(jsonLd.image)
          ? jsonLd.image[0]?.url || jsonLd.image[0]
          : jsonLd.image?.url || jsonLd.image?.contentUrl)) ||
    meta("og:image") ||
    meta("twitter:image") ||
    meta("og:image:secure_url") ||
    "";

  let priceRaw =
    (jsonLd && priceFromOffers(jsonLd.offers)) ||
    meta("product:price:amount") ||
    meta("og:price:amount") ||
    meta("twitter:data1") ||
    "";

  if (!priceRaw) {
    const bodyPrice = html.match(
      /(?:Rs\.?|PKR|USD|\$|EUR|€|£)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i,
    );
    if (bodyPrice) priceRaw = bodyPrice[1];
  }

  const price = String(priceRaw)
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/)?.[1] || "";

  title = decodeEntities(String(title)).slice(0, 160);
  desc = decodeEntities(String(desc)).slice(0, 600);
  image = decodeEntities(String(image));

  const pcsMatch = `${title} ${desc}`.match(
    /(\d+)\s*(?:pcs|pieces|pack|ct|count|-pack|pc\b)/i,
  );

  return {
    title,
    desc,
    image,
    price,
    pcs: pcsMatch?.[1] || "",
  };
}

function applyExtractedFields({ title, description, desc, image, price, pcs }) {
  let filled = 0;
  const d = description || desc || "";
  if ($("#p-name") && title) {
    $("#p-name").value = title;
    filled++;
  }
  if ($("#p-desc") && d) {
    $("#p-desc").value = d;
    filled++;
  }
  if ($("#p-item") && price) {
    $("#p-item").value = price;
    filled++;
  }
  if ($("#p-pcs") && pcs) {
    $("#p-pcs").value = pcs;
    filled++;
  }
  if ($("#p-image") && image) {
    $("#p-image").value = image;
    if ($("#p-thumb-wrap")) $("#p-thumb-wrap").innerHTML = thumbHtml(image);
    filled++;
  }
  return filled;
}

/** Primary path: Vercel /api/extract (server-side, no CORS). */
async function extractViaApi(normalized) {
  const res = await fetch(`/api/extract?url=${encodeURIComponent(normalized)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let msg = `Extract failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Local-dev fallback only. Public proxies often 403 marketplace sites —
 * failures are swallowed so the console stays clean.
 */
async function extractViaProxyFallback(normalized) {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  for (const make of proxies) {
    try {
      const res = await fetch(make(normalized), {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "text/html,*/*" },
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 200 && /<html|<head|<meta|ld\+json/i.test(text)) {
        return extractProductFromHtml(text);
      }
    } catch {
      /* silent — proxies are unreliable by design */
    }
  }
  return null;
}

async function tryFetchUrl(url) {
  if (!url) return toast("Paste a link first.", "error");
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  try {
    // eslint-disable-next-line no-new
    new URL(normalized);
  } catch {
    return toast("That does not look like a valid link.", "error");
  }

  if ($("#p-url")) $("#p-url").value = normalized;
  toast("Reading page…");

  let data = null;

  // 1) Server-side extract (works on Vercel for Daraz, Amazon, …)
  try {
    data = await extractViaApi(normalized);
  } catch {
    // 2) Quiet proxy fallback for local static servers without /api
    data = await extractViaProxyFallback(normalized);
  }

  if (!data) {
    toast(
      "Could not read this page. Deploy to Vercel so /api/extract can fetch it, or enter name, price, and photo manually — the link is still saved.",
      "error",
    );
    return;
  }

  const filled = applyExtractedFields(data);
  if (filled === 0) {
    toast(
      "Page loaded but no product fields found (some shops hide data in scripts). Enter details manually.",
      "error",
    );
  } else {
    toast(`Pulled ${filled} field${filled === 1 ? "" : "s"} — double-check price before saving.`);
  }
}

async function openAddToTrip(productId, fixedTripId = null) {
  const product = await storage.getProduct(productId);
  if (!product) return;
  let trips = [];
  try {
    trips = (await storage.listTrips()).filter((t) => t.status === "open");
  } catch {
    /* ignore */
  }
  let unit = product.defaultUnit || "item";
  let quantity = 1;
  const currency = trips.find((t) => t.id === fixedTripId)?.currency || trips[0]?.currency || "USD";

  openModal(`
    <div class="modal-header">
      <div>
        <h2>Add to list</h2>
        <p class="modal-desc">Choose item or box, set how many you need, and Cartwise totals it against your budget.</p>
      </div>
      <button type="button" class="modal-close" data-close>×</button>
    </div>
    <div class="card" style="padding:0.75rem;background:var(--muted-bg);box-shadow:none;margin-bottom:1rem">
      <div class="flex-gap">
        ${thumbHtml(product.imageUrl)}
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          ${product.pcsPerBox ? `<p class="text-muted" style="font-size:0.8125rem;margin:0.15rem 0 0">${product.pcsPerBox} pcs per box</p>` : ""}
          <p class="text-muted tabular" style="font-size:0.8125rem;margin:0.25rem 0 0">
            ${product.pricePerItem > 0 ? `${formatMoney(product.pricePerItem, currency)} / item` : "No item price"}
            ${product.pricePerBox > 0 ? ` · ${formatMoney(product.pricePerBox, currency)} / box` : ""}
          </p>
        </div>
      </div>
    </div>
    ${
      fixedTripId
        ? ""
        : `<div class="field mb-4">
            <label for="add-trip">List</label>
            <select class="select" id="add-trip">
              ${
                trips.length
                  ? trips
                      .map(
                        (t) =>
                          `<option value="${t.id}">${escapeHtml(t.name)} · ${formatMoney(t.spent, t.currency)} of ${formatMoney(t.budget, t.currency)}</option>`,
                      )
                      .join("")
                  : `<option value="">Create a list first</option>`
              }
            </select>
          </div>`
    }
    ${
      product.pcsPerBox && product.pcsPerBox > 1
        ? `<div class="field mb-4">
            <label for="need-pcs">I need this many pieces</label>
            <input class="input" id="need-pcs" inputmode="numeric" value="${Math.min(5, product.pcsPerBox)}" />
            <div class="stack mt-2" id="suggest-opts"></div>
          </div>`
        : ""
    }
    <div class="grid-2 mb-4">
      <div class="field">
        <label>Buy as</label>
        <div class="segment" id="add-unit">
          <button type="button" data-unit="item" class="${unit === "item" ? "active" : ""}">Item</button>
          <button type="button" data-unit="box" class="${unit === "box" ? "active" : ""}">Box</button>
        </div>
      </div>
      <div class="field">
        <label>Quantity</label>
        <div class="stepper">
          <button type="button" id="add-dec">−</button>
          <input type="number" min="1" id="add-qty" value="1" />
          <button type="button" id="add-inc">+</button>
        </div>
      </div>
    </div>
    <div class="line-total-bar">
      <span class="text-muted" style="font-size:0.875rem">Line total</span>
      <strong class="tabular" id="add-total" style="font-family:var(--display);font-size:1.25rem"></strong>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" id="add-confirm">Add to list</button>
    </div>`);

  const updateTotal = () => {
    const total = lineTotal({
      unit,
      quantity,
      pricePerItem: product.pricePerItem,
      pricePerBox: product.pricePerBox,
    });
    $("#add-total").textContent = formatMoney(total, currency);
  };
  const setUnit = (u) => {
    unit = u;
    $$("#add-unit button").forEach((b) => b.classList.toggle("active", b.dataset.unit === unit));
    updateTotal();
  };
  const setQty = (n) => {
    quantity = Math.max(1, Math.round(n));
    $("#add-qty").value = quantity;
    updateTotal();
  };
  const refreshSuggest = () => {
    const box = $("#suggest-opts");
    if (!box) return;
    const need = Number($("#need-pcs")?.value) || 1;
    const opts = suggestPurchases({
      needPieces: need,
      pricePerItem: product.pricePerItem,
      pricePerBox: product.pricePerBox,
      pcsPerBox: product.pcsPerBox,
    });
    box.innerHTML = opts
      .map(
        (o, i) => `
      <button type="button" class="option-btn suggest ${unit === o.unit && quantity === o.quantity ? "selected" : ""}" data-u="${o.unit}" data-q="${o.quantity}">
        <span>
          <span style="display:block;font-weight:500;font-size:0.875rem">${escapeHtml(o.label)}</span>
          <span class="text-muted" style="font-size:0.75rem">Covers ${o.pieces} pcs</span>
        </span>
        <span class="flex-gap">
          ${i === 0 ? `<span class="badge badge-success">Better value</span>` : ""}
          <span class="tabular" style="font-weight:500">${formatMoney(o.total, currency)}</span>
        </span>
      </button>`,
      )
      .join("");
    $$(".suggest", box).forEach((btn) => {
      btn.addEventListener("click", () => {
        setUnit(btn.dataset.u);
        setQty(Number(btn.dataset.q));
        refreshSuggest();
      });
    });
  };

  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  $$("#add-unit button").forEach((btn) => btn.addEventListener("click", () => setUnit(btn.dataset.unit)));
  $("#add-dec").addEventListener("click", () => setQty(quantity - 1));
  $("#add-inc").addEventListener("click", () => setQty(quantity + 1));
  $("#add-qty").addEventListener("change", () => setQty(Number($("#add-qty").value)));
  $("#need-pcs")?.addEventListener("input", refreshSuggest);
  refreshSuggest();
  updateTotal();

  $("#add-confirm").addEventListener("click", async () => {
    const tripId = fixedTripId || $("#add-trip")?.value;
    if (!tripId) {
      toast("Create a list first.", "error");
      return;
    }
    try {
      await storage.addItem({
        tripId,
        productId: product.id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        unit,
        quantity,
        pricePerItem: product.pricePerItem,
        pricePerBox: product.pricePerBox,
        pcsPerBox: product.pcsPerBox,
      });
      closeModal();
      toast("Added to your list");
      navigate(`trip/${tripId}`);
    } catch (e) {
      toast(e.message || "Could not add item", "error");
    }
  });
}

async function onExport() {
  try {
    const json = await storage.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cartwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  } catch (e) {
    toast(e.message || "Export failed", "error");
  }
}

async function route() {
  if (!currentUser) {
    renderAuth();
    return;
  }
  const { page, id } = parseRoute();
  if (page === "catalog") await renderCatalog();
  else if (page === "trip" && id) await renderTrip(id);
  else await renderHome();
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!location.hash) location.hash = "#/home";
  route();
});

window.addEventListener("hashchange", () => {
  if (busy) return;
  route();
});
