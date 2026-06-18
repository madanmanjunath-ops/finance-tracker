# 👋 START HERE — Finance Tracker setup for absolute beginners

This guide takes you from **nothing** to a **working app you can log into
from your phone and laptop**, with the AI features switched on.

No coding. Just clicking, copying, and pasting. Take it one step at a time.

You'll set up **three free things**:
1. **Netlify** — puts your app online (gives it a web address).
2. **Anthropic** — powers the AI features (reading emails, the coach).
3. **Supabase** — gives you a login and syncs your data across devices.

⏱️ Total time: about **30–40 minutes**. Grab a coffee. ☕

> 💡 Tip: do the steps **in order**. After each part there's a
> "✅ You'll know it worked when…" line. Don't move on until you see it.

---

# PART 1 — Get the app onto your computer (5 min)

1. Download the project ZIP (the download card in the chat).
2. Find the downloaded file (usually in your **Downloads** folder).
3. **Unzip it:**
   - **Windows:** right-click the ZIP → *Extract All* → *Extract*.
   - **Mac:** double-click the ZIP.
4. You now have a **folder** with files inside it like `index.html`,
   `styles.css`, `supabase-config.js`, and others. Keep this folder handy.

✅ **You'll know it worked when:** you can open the folder and see a file
called **`index.html`** inside it.

---

# PART 2 — Put the app online with Netlify (10 min)

This gives your app a real web address so you can open it anywhere.

1. Go to **https://www.netlify.com** and click **Sign up**. Use your
   email or "Sign up with Google" — whatever's easiest. It's free.
2. Once logged in, go to **https://app.netlify.com/drop**
3. **Drag your whole project folder** onto that page (the folder from
   Part 1 — the one with `index.html` inside).
4. Wait about 30 seconds. Netlify gives you a link like
   `https://random-name-12345.netlify.app`.
5. Click it. **Your app opens!** 🎉

> 🔧 Want a nicer address? In Netlify: **Site configuration → Change site
> name** → type something like `aarav-finances`. Your link becomes
> `https://aarav-finances.netlify.app`.

✅ **You'll know it worked when:** your app opens at a netlify.app web
address. (Right now it works in "local only" mode — that's expected.
We'll switch on AI and login next.)

---

# PART 3 — Turn on the AI features (10 min)

The AI buttons ("Parse with AI", the investment coach) need a key.

### 3a. Get your AI key
1. Go to **https://console.anthropic.com** and sign up / log in.
2. Add a little credit: **Billing** → add **$5** (personal use costs only
   pennies; this just lets it run).
3. Go to **API Keys** → **Create Key** → give it any name → **Copy** the
   key it shows you. ⚠️ Copy it now — you can't see it again later.
   It looks like `sk-ant-api03-xxxxxxxx...`

### 3b. Give the key to Netlify (safely)
1. In **Netlify**, open your site → **Site configuration** →
   **Environment variables** → **Add a variable**.
2. Add this one:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** paste the `sk-ant-...` key you copied.
3. Add a second variable to keep it private (recommended):
   - **Key:** `APP_SECRET`
   - **Value:** make up a long password, e.g. `myMoney_2026_x7Qp` — and
     write it down, you'll need it once more.
4. Click **Save**.
5. Now **redeploy** so the keys take effect: **Deploys** tab → **Trigger
   deploy** → **Deploy site**. Wait ~30 seconds.

### 3c. Switch the AI on inside the app
1. Open your live site → click **Settings** (left menu).
2. Find **AI service** → paste your `APP_SECRET` password into the
   **AI access key** box → **Save key**.
3. Click **Test connection**. You want to see **"Connected — the AI
   features are live."**

✅ **You'll know it worked when:** go to **Email Import**, click a sample
email, hit **Parse with AI**, and it fills in the details automatically.

---

# PART 4 — Turn on login & cloud sync (10 min)

This gives you a password-protected login and syncs your data to your
phone and laptop.

### 4a. Create a Supabase project
1. Go to **https://supabase.com** → **Start your project** → sign up
   (free).
2. Click **New project**. Give it a name (e.g. `finance-tracker`), set a
   **database password** (write it down), pick the region closest to you,
   then **Create new project**. Wait ~2 minutes.

### 4b. Create the data table (copy-paste, don't worry what it means)
1. In Supabase, click **SQL Editor** (left menu) → **New query**.
2. Open the file **`SUPABASE-SETUP.md`** in your project folder, find the
   big code block under *"Step 2"*, and **copy all of it**.
3. Paste it into the Supabase query box → click **Run**.
   You should see "Success".

### 4c. Get your two Supabase keys
1. In Supabase: **Project Settings** (gear icon) → **API**.
2. Copy these two:
   - **Project URL** (like `https://abcd1234.supabase.co`)
   - **anon public** key (a very long string)

### 4d. Connect the app to Supabase (the easy way — no file editing!)
1. Open your **live site** → click **Settings** (left menu).
2. Scroll to **Account & sync**. You'll see two boxes.
3. Paste your **Project URL** into the first box.
4. Paste your **anon public key** into the second box.
5. Click **Connect cloud sync**.
6. The page reloads and a **login screen** appears. 🎉

> 💡 Why this is better: you paste into normal boxes, so there's no file
> to edit and no "smart quotes" problem. You also **don't** need to
> re-drag the folder for this step — it takes effect immediately.

> 🧩 Optional (advanced): you can instead hard-code the keys in
> `supabase-config.js` and redeploy. The in-app box above is the
> easy path and does the exact same thing.

✅ **You'll know it worked when:** open your live site and you now see a
**login screen** instead of going straight to the app.

---

# PART 5 — Create your account & finish (2 min)

1. On the login screen, click **Create an account**.
2. Enter your email + a password (at least 6 characters) → **Create
   account**.
   - If it says "check your inbox", open the email from Supabase and click
     the confirm link, then come back and **Sign in**.
3. You're in! The left side shows your email and **"All changes synced"**.
4. **The magic test:** open the same web address on your **phone**, sign
   in with the same email/password → your data is right there. 🎉

✅ **You'll know it ALL worked when:** you add a transaction on your
laptop, refresh your phone, and it shows up.

---

# 🆘 If something goes wrong

- **AI test fails / "model" error:** in Netlify → Environment variables,
  add `CLAUDE_MODEL` with a current model name, then redeploy. (Ask me for
  the latest name if unsure.)
- **No login screen appears:** open **Settings → Account & sync** and
  paste your Project URL + anon key into the boxes, then **Connect cloud
  sync**. (Make sure you redeployed the latest app folder first.)
- **"row-level security" error when saving:** re-run the SQL from Part 4b.
- **Sign-up wants email confirmation:** in Supabase → **Authentication →
  Providers → Email**, turn *Confirm email* off while testing (turn it
  back on later).
- **Forgot your APP_SECRET:** just set a new one in Netlify, redeploy, and
  update it in Settings → AI service.

---

# 📁 What each file is (you rarely need this)
| File | What it does |
|---|---|
| `index.html` | The app itself — the thing that opens |
| `supabase-config.js` | Where YOU paste your Supabase keys (Part 4d) |
| `netlify.toml` + `netlify/functions/` | The secure AI helper |
| `SUPABASE-SETUP.md` | The SQL to paste + deeper details |
| `DEPLOY.md` | More detail on hosting + the AI proxy |
| the rest | App code — leave it alone |

---

## 💾 Always have a backup
Inside the app: **Settings → Backup all data (JSON)** saves a copy to your
computer anytime. Good habit before big changes.

That's it — you did it. Welcome to your own personal finance app. 💚
