/** Currency helpers for Cartwise */

export const CURRENCIES = [
  { code: "USD", label: "US Dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British Pound" },
  { code: "PKR", label: "Pakistani Rupee" },
  { code: "INR", label: "Indian Rupee" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "AED", label: "UAE Dirham" },
  { code: "JPY", label: "Japanese Yen" },
  { code: "PHP", label: "Philippine Peso" },
];

export function roundMoney(n) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function formatMoney(amount, currency = "USD") {
  const code = currency || "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${code} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
}

export function lineTotal({ unit, quantity, pricePerItem, pricePerBox }) {
  const unitPrice = unit === "box" ? pricePerBox : pricePerItem;
  return roundMoney(Math.max(0, quantity) * Math.max(0, unitPrice));
}

export function derivePrices({ pricePerItem, pricePerBox, pcsPerBox }) {
  let item = pricePerItem ?? 0;
  let box = pricePerBox ?? 0;
  const pcs = pcsPerBox && pcsPerBox > 0 ? pcsPerBox : 0;
  if (item <= 0 && box > 0 && pcs > 0) item = roundMoney(box / pcs);
  if (box <= 0 && item > 0 && pcs > 0) box = roundMoney(item * pcs);
  return { pricePerItem: item, pricePerBox: box };
}

export function suggestPurchases({ needPieces, pricePerItem, pricePerBox, pcsPerBox }) {
  const need = Math.max(1, Math.round(needPieces));
  const options = [];
  if (pricePerItem > 0) {
    options.push({
      unit: "item",
      quantity: need,
      pieces: need,
      total: roundMoney(need * pricePerItem),
      label: `${need} item${need === 1 ? "" : "s"}`,
    });
  }
  const pcs = pcsPerBox && pcsPerBox > 0 ? pcsPerBox : 0;
  if (pcs > 0 && pricePerBox > 0) {
    const boxes = Math.max(1, Math.ceil(need / pcs));
    options.push({
      unit: "box",
      quantity: boxes,
      pieces: boxes * pcs,
      total: roundMoney(boxes * pricePerBox),
      label: `${boxes} box${boxes === 1 ? "" : "es"} · ${boxes * pcs} pcs`,
    });
  }
  return options.sort((a, b) => a.total - b.total);
}
