# Getting this live — step by step

Everything here is done through web browsers (GitHub + Firebase console). No terminal required.

## 1. Create the GitHub repo
1. Go to github.com → **New repository** → name it e.g. `oshe-crm` → **Create repository** (private is fine, recommended).
2. On the empty repo page, click **uploading an existing file**.
3. Drag the *entire contents* of this project folder in (including the hidden `.github` folder and `.gitignore` — if your browser doesn't show hidden folders when dragging, unzip and drag the whole folder itself, GitHub will preserve the structure).
4. Commit directly to `main`.

## 2. Get a Firebase service account key (for automatic deploys)
This is what lets GitHub Actions deploy on your behalf — no CLI, no login needed each time.
1. Firebase console → your `oshe-895ad` project → gear icon → **Project Settings**.
2. Go to the **Service accounts** tab.
3. Click **Generate new private key** → confirm → a `.json` file downloads.
4. Open that file in a text editor, select all, copy it.
5. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the entire JSON file contents
   - Save.
6. **Keep that downloaded JSON file safe and don't commit it to the repo** — it's a master key to your Firebase project. Delete it from your Downloads folder once it's saved as a GitHub secret.

Once step 2 is done, every push to `main` will automatically build and deploy the app, and push the Firestore/Storage security rules.

## 3. Create your team's logins (this is where the passwords live)
Since you're big on security — there is no public sign-up for this app. Only accounts you create yourself can log in.
1. Firebase console → **Build → Authentication** → **Get started** if you haven't already.
2. Under **Sign-in method**, enable **Email/Password**.
3. Go to the **Users** tab → **Add user** → enter an email + a password for each of Vanessa, Sophie, Judith, and Jo. Do this four times.
4. Optional but recommended, since security matters to you: **Authentication → Settings → Password policy** → turn on **Enforce password policy** and set a minimum length (8+) and require mixed case/numbers. This stops anyone setting a weak password later.
5. For each person's Firebase Auth account, note their **User UID** (shown in the Users table) — I'll need these to finish the `team` collection mapping (so "who's logged in" connects to "who they are" inside the app). Send me the four UIDs + names once created and I'll wire that in.

## 4. Connect your custom domain
1. Firebase console → **Build → Hosting**.
2. Click **Add custom domain**.
3. Enter your domain (e.g. `crm.osheconsulting.co.nz`, or whatever you'd like to use).
4. Firebase will give you one or two DNS records (usually a TXT record to verify ownership, then an A record or two).
5. Add those records wherever your domain's DNS is managed (Crazy Domains, based on how the rest of OSHE's DNS has been set up before).
6. Verification usually takes a few minutes to a few hours. Firebase issues a free SSL certificate automatically once it's verified — nothing else to do.

## 5. First deploy
Once steps 1–2 are done, just push a commit (even a small one, like editing this file) to `main` and check the **Actions** tab in GitHub — you'll see it build and deploy. Once it's green, your site is live at the `.web.app` URL Firebase gives you by default, and at your custom domain once step 4 finishes.

---

**What's real right now vs. what's next:** login is fully real (Firebase Auth, password-protected). The app itself still runs on the same mock data as the version you've been testing in chat — Firestore wiring happens module by module from here, starting with Clients.
