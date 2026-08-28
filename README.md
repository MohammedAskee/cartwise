# Cartwise

Shop with a budget, not a guess.

Static web app with **Firebase Authentication** (email/password) and **Firestore** for synced shopping lists, catalogs, and budgets.

## Features

- Email sign-up / sign-in
- Catalog: name, notes, image, price per item / box, pieces per box
- Lists with budget meter and currencies
- Item vs box pricing + “I need N pieces” suggestions
- Shop mode checklist
- Sample data seed
- JSON export backup

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

## License

Use freely for personal or commercial projects.
