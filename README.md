# Cartwise

Shop with a budget, not a guess.

Static web app with **Firebase Authentication** (email/password) and **Firestore** for synced shopping lists, catalogs, and budgets.

## Features

- Email sign-up / sign-in
- Catalog: name, notes, image, price per item / box, pieces per box
- Paste a product link to auto-fill title, description, image, and price when possible
- Lists with budget meter and currencies
- Item vs box pricing + “I need N pieces” suggestions
- Shop mode checklist
- Sample data seed
- JSON export backup

## Product link extraction

Browsers block most store sites (Daraz, Amazon, etc.) from being read directly. Cartwise tries public CORS proxies and parses Open Graph + JSON-LD. When a site blocks those proxies you will see a clear message — **paste name, price, and photo manually**; the URL is still stored for reference. A future small backend can make extraction reliable for every shop.

## Firebase setup (required once)

### 1. Authentication

Firebase Console → **Authentication** → **Sign-in method** → enable **Email/Password**.

### 2. Firestore

Firebase Console → **Firestore Database** → create database (production mode is fine).

Then **Rules** → paste the contents of `firestore.rules` from this repo → **Publish**.

### 3. Authorized domains (for Vercel)

Firebase Console → **Authentication** → **Settings** → **Authorized domains**  
Add your Vercel domain, e.g. `cartwise.vercel.app` and `localhost`.

### 4. Indexes

First queries may ask you to create a composite index for  
`collection + userId`. Click the link in the browser console error and accept the suggested index.

## Deploy to GitHub + Vercel

### GitHub

1. Create a new repository (e.g. `cartwise`).
2. Upload **all files inside the `cartwise` folder** to the repo root (not nested in another folder).

Using Git:

```bash
cd cartwise
git init
git add .
git commit -m "Cartwise with Firebase"
git branch -M main
git remote add origin https://github.com/YOUR_USER/cartwise.git
git push -u origin main
```

Or use GitHub’s web UI: **Add file → Upload files**.

### Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → import the GitHub repo.
2. Framework preset: **Other** (static).
3. Root directory: leave default (repo root).
4. Build command: empty. Output directory: empty (or `.`).
5. Deploy.

After deploy, add the Vercel domain under Firebase **Authorized domains**.

## Local preview

```bash
npx --yes serve .
```

Open the URL shown (must be `http://`, not `file://`).

## Project layout

```
index.html
css/styles.css
js/app.js
lib/firebase-config.js   # your project keys
lib/firebase.js
lib/storage.js           # Firestore data layer
lib/money.js
lib/image.js
assets/favicon.svg
firestore.rules
vercel.json
README.md
```

## Security note

Firebase web API keys are public in client apps. Data is protected by **Authentication + Firestore rules** (users only read/write their own `userId` documents). Do not open rules to `allow read, write: if true`.

## Troubleshooting

- **`firestore.googleapis.com/... ERR_BLOCKED_BY_CLIENT`** — an ad blocker or privacy extension is blocking Firestore’s long-poll channel. Whitelist your app domain (and `firestore.googleapis.com`) or disable the blocker on this site. Lists usually still load after a refresh.
- **Product link 403 on `corsproxy.io`** — ignore if you still see that on an old deploy. Redeploy so the app uses `/api/extract` instead of public proxies.
- **Fetch works only after Vercel deploy** — expected. Server extract requires the `api/extract.js` function.

## License

Use freely for personal or commercial projects.
