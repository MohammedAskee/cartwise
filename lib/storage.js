/**
 * Cartwise data layer — Firebase Auth + Firestore.
 * Collections: products, trips, items (each document has userId).
 */
import {
  auth,
  db,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  uid,
} from "./firebase.js";

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in required");
  return user;
}

function enrichTrip(trip, items) {
  const mine = items.filter((it) => it.tripId === trip.id);
  let spent = 0;
  let checked = 0;
  for (const it of mine) {
    if (it.checked) checked += 1;
    const unitPrice = it.unit === "box" ? it.pricePerBox : it.pricePerItem;
    spent += Math.max(0, it.quantity) * Math.max(0, unitPrice);
  }
  return {
    ...trip,
    itemCount: mine.length,
    checkedCount: checked,
    spent: Math.round(spent * 100) / 100,
  };
}

async function listByUser(colName) {
  const user = requireUser();
  const q = query(collection(db, colName), where("userId", "==", user.uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export const storage = {
  async listProducts() {
    const products = await listByUser("products");
    return products.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async getProduct(id) {
    const user = requireUser();
    const snap = await getDoc(doc(db, "products", id));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.userId !== user.uid) return null;
    return { id: snap.id, ...data };
  },

  async saveProduct(input) {
    const user = requireUser();
    const now = Date.now();
    if (input.id) {
      const ref = doc(db, "products", input.id);
      const existing = await getDoc(ref);
      if (!existing.exists() || existing.data().userId !== user.uid) {
        throw new Error("Product not found");
      }
      const next = {
        name: input.name,
        description: input.description || "",
        sourceUrl: input.sourceUrl || null,
        imageUrl: input.imageUrl || null,
        pricePerItem: Number(input.pricePerItem) || 0,
        pricePerBox: Number(input.pricePerBox) || 0,
        pcsPerBox: input.pcsPerBox ? Math.round(Number(input.pcsPerBox)) : null,
        defaultUnit: input.defaultUnit === "box" ? "box" : "item",
        updatedAt: now,
      };
      await updateDoc(ref, next);
      return { id: input.id, ...existing.data(), ...next };
    }
    const id = uid();
    const product = {
      userId: user.uid,
      name: input.name,
      description: input.description || "",
      sourceUrl: input.sourceUrl || null,
      imageUrl: input.imageUrl || null,
      pricePerItem: Number(input.pricePerItem) || 0,
      pricePerBox: Number(input.pricePerBox) || 0,
      pcsPerBox: input.pcsPerBox ? Math.round(Number(input.pcsPerBox)) : null,
      defaultUnit: input.defaultUnit === "box" ? "box" : "item",
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, "products", id), product);
    return { id, ...product };
  },

  async deleteProduct(id) {
    const user = requireUser();
    const ref = doc(db, "products", id);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().userId !== user.uid) return;
    await deleteDoc(ref);
    const items = await listByUser("items");
    const batch = writeBatch(db);
    items
      .filter((it) => it.productId === id)
      .forEach((it) => batch.update(doc(db, "items", it.id), { productId: null }));
    await batch.commit();
  },

  async listTrips() {
    const [trips, items] = await Promise.all([listByUser("trips"), listByUser("items")]);
    return trips
      .map((t) => enrichTrip(t, items))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  },

  async getTrip(id) {
    const user = requireUser();
    const snap = await getDoc(doc(db, "trips", id));
    if (!snap.exists()) return null;
    const trip = { id: snap.id, ...snap.data() };
    if (trip.userId !== user.uid) return null;
    const allItems = await listByUser("items");
    const items = allItems
      .filter((it) => it.tripId === id)
      .sort((a, b) => {
        if (a.checked !== b.checked) return a.checked ? 1 : -1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
    return { trip: enrichTrip(trip, items), items };
  },

  async saveTrip(input) {
    const user = requireUser();
    const now = Date.now();
    if (input.id) {
      const ref = doc(db, "trips", input.id);
      const existing = await getDoc(ref);
      if (!existing.exists() || existing.data().userId !== user.uid) {
        throw new Error("List not found");
      }
      const next = {
        name: input.name,
        budget: Math.max(0, Number(input.budget) || 0),
        currency: (input.currency || "USD").toUpperCase(),
        status: input.status === "done" ? "done" : "open",
        updatedAt: now,
      };
      await updateDoc(ref, next);
      return enrichTrip({ id: input.id, ...existing.data(), ...next }, []);
    }
    const id = uid();
    const trip = {
      userId: user.uid,
      name: input.name || "Shopping list",
      budget: Math.max(0, Number(input.budget) || 0),
      currency: (input.currency || "USD").toUpperCase(),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, "trips", id), trip);
    return enrichTrip({ id, ...trip }, []);
  },

  async deleteTrip(id) {
    const user = requireUser();
    const ref = doc(db, "trips", id);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().userId !== user.uid) return;
    await deleteDoc(ref);
    const items = await listByUser("items");
    const batch = writeBatch(db);
    items.filter((it) => it.tripId === id).forEach((it) => batch.delete(doc(db, "items", it.id)));
    await batch.commit();
  },

  async addItem(input) {
    const user = requireUser();
    const tripSnap = await getDoc(doc(db, "trips", input.tripId));
    if (!tripSnap.exists() || tripSnap.data().userId !== user.uid) {
      throw new Error("List not found");
    }
    const siblings = (await listByUser("items")).filter((it) => it.tripId === input.tripId);
    const sortOrder = siblings.reduce((m, it) => Math.max(m, it.sortOrder || 0), 0) + 1;
    const id = uid();
    const item = {
      userId: user.uid,
      tripId: input.tripId,
      productId: input.productId || null,
      name: input.name,
      description: input.description || "",
      imageUrl: input.imageUrl || null,
      unit: input.unit === "box" ? "box" : "item",
      quantity: Math.max(1, Math.round(Number(input.quantity) || 1)),
      pricePerItem: Number(input.pricePerItem) || 0,
      pricePerBox: Number(input.pricePerBox) || 0,
      pcsPerBox: input.pcsPerBox ? Math.round(Number(input.pcsPerBox)) : null,
      checked: false,
      sortOrder,
      createdAt: Date.now(),
    };
    await setDoc(doc(db, "items", id), item);
    await updateDoc(doc(db, "trips", input.tripId), { updatedAt: Date.now() });
    return { id, ...item };
  },

  async updateItem(id, patch) {
    const user = requireUser();
    const ref = doc(db, "items", id);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().userId !== user.uid) {
      throw new Error("Item not found");
    }
    const next = { ...patch };
    if (patch.quantity != null) {
      next.quantity = Math.max(1, Math.round(Number(patch.quantity)));
    }
    await updateDoc(ref, next);
    const tripId = snap.data().tripId;
    await updateDoc(doc(db, "trips", tripId), { updatedAt: Date.now() });
    return { id, ...snap.data(), ...next };
  },

  async deleteItem(id) {
    const user = requireUser();
    const ref = doc(db, "items", id);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().userId !== user.uid) return;
    const tripId = snap.data().tripId;
    await deleteDoc(ref);
    await updateDoc(doc(db, "trips", tripId), { updatedAt: Date.now() });
  },

  async seedSample() {
    const user = requireUser();
    const now = Date.now();
    const products = [
      {
        id: uid(),
        name: "Sour candy belts",
        description: "Chewy sour belts. Sold loose or in a 10-pack box.",
        pricePerItem: 0.45,
        pricePerBox: 3.99,
        pcsPerBox: 10,
        defaultUnit: "item",
      },
      {
        id: uid(),
        name: "Whole milk",
        description: "1 litre carton.",
        pricePerItem: 1.85,
        pricePerBox: 0,
        pcsPerBox: null,
        defaultUnit: "item",
      },
      {
        id: uid(),
        name: "Free-range eggs",
        description: "Box of 12.",
        pricePerItem: 0.35,
        pricePerBox: 3.4,
        pcsPerBox: 12,
        defaultUnit: "box",
      },
      {
        id: uid(),
        name: "Sourdough loaf",
        description: "Country loaf from the bakery counter.",
        pricePerItem: 4.5,
        pricePerBox: 0,
        pcsPerBox: null,
        defaultUnit: "item",
      },
    ];
    const batch = writeBatch(db);
    for (const p of products) {
      const { id, ...rest } = p;
      batch.set(doc(db, "products", id), {
        userId: user.uid,
        sourceUrl: null,
        imageUrl: null,
        createdAt: now,
        updatedAt: now,
        ...rest,
      });
    }
    const tripId = uid();
    batch.set(doc(db, "trips", tripId), {
      userId: user.uid,
      name: "Weekly shop",
      budget: 80,
      currency: "USD",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    const samples = [
      { p: products[0], qty: 5, unit: "item" },
      { p: products[1], qty: 2, unit: "item" },
      { p: products[2], qty: 1, unit: "box" },
      { p: products[3], qty: 1, unit: "item" },
    ];
    samples.forEach((s, idx) => {
      const itemId = uid();
      batch.set(doc(db, "items", itemId), {
        userId: user.uid,
        tripId,
        productId: s.p.id,
        name: s.p.name,
        description: s.p.description,
        imageUrl: null,
        unit: s.unit,
        quantity: s.qty,
        pricePerItem: s.p.pricePerItem,
        pricePerBox: s.p.pricePerBox,
        pcsPerBox: s.p.pcsPerBox,
        checked: false,
        sortOrder: idx + 1,
        createdAt: now,
      });
    });
    await batch.commit();
    return tripId;
  },

  async exportJson() {
    const [products, trips, items] = await Promise.all([
      listByUser("products"),
      listByUser("trips"),
      listByUser("items"),
    ]);
    return JSON.stringify({ products, trips, items, meta: { version: 1 } }, null, 2);
  },
};
