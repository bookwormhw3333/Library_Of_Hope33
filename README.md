# Library of Hope

A cozy, old-money-styled personal library tracker — shelf view, series-completion tracker,
full spreadsheet catalog, lending tracker, and your "Library of Hope" emboss tracker.

This version stores data in Supabase (a free hosted Postgres database) instead of
Claude's built-in artifact storage, so it works as a real, standalone website.

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free tier is plenty for this).
2. Click **New project**. Pick any name/region, set a database password (save it somewhere), and wait ~2 minutes for it to spin up.
3. In your new project, go to the **SQL Editor** (left sidebar) and run this to create your tables:

```sql
create table books (
  id text primary key,
  title text not null,
  author_first text,
  author_last text,
  genre text,
  series_name text,
  series_number text,
  read boolean default false,
  lent_to text,
  stamped boolean default false,
  added_at bigint
);

create table series_info (
  series_name text primary key,
  total integer,
  books jsonb,
  looked_up_at bigint
);

alter table books enable row level security;
alter table series_info enable row level security;

create policy "public access" on books for all using (true) with check (true);
create policy "public access" on series_info for all using (true) with check (true);
```

> **Note on security:** these policies allow anyone who has your Supabase URL and
> anon key to read/write your books. That's normal for a small personal project
> like this, but it does mean don't share those keys publicly. If you'd ever like
> a login screen in front of it, that's a small addition I can help with later.

4. Go to **Project Settings → API**. You'll need two values from this page:
   - **Project URL**
   - **anon / public key**

---

## 2. Run it locally

1. Install [Node.js](https://nodejs.org) if you don't have it.
2. In this project folder, install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your two Supabase values:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
4. Start it:
   ```
   npm run dev
   ```
5. Open the local address it prints (usually `http://localhost:5173`). You should see
   your empty library — add a book to confirm it's saving (check the Supabase
   **Table Editor** to see the row appear).

---

## 3. Put it on GitHub

1. Create a free account at [github.com](https://github.com) if needed.
2. Create a new empty repository (e.g. `library-of-hope`).
3. From this project folder:
   ```
   git init
   git add .
   git commit -m "Library of Hope"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/library-of-hope.git
   git push -u origin main
   ```
   (Your `.env` file is already excluded via `.gitignore` — your keys won't be uploaded.)

---

## 4. Deploy it (Vercel or Netlify — both free)

**Vercel:**
1. Go to [vercel.com](https://vercel.com), sign in with GitHub.
2. Click **Add New → Project**, pick your `library-of-hope` repo.
3. Before deploying, add your environment variables (Settings → Environment Variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**. In about a minute you'll get a live link like `library-of-hope.vercel.app`.

**Netlify** works the same way — "Add new site → Import from Git," set the same two
environment variables under Site settings, deploy.

---

## 5. Add your own domain

1. Buy a domain from a registrar — Namecheap, Porkbun, or Squarespace Domains are
   all straightforward, usually $10–20/year for a `.com`.
2. In Vercel or Netlify, go to your project's **Domains** settings and add your domain.
3. It'll show you 1–2 DNS records to add. Go to your registrar's DNS settings and add them.
4. Wait up to an hour for DNS to propagate — then your library lives at your own address.

---

## Notes

- The "To Complete Series" tab uses a manual total-count field to figure out what's
  missing. The earlier Claude-artifact version could search the web for a series'
  full reading order automatically — that used a Claude-specific feature that
  isn't available once the site is standalone. If you'd like that back, it's
  possible to add via a small serverless function using your own Anthropic API key
  — just ask.
- All styling lives in `src/App.jsx` as inline styles plus one `<style>` block —
  no build step needed to tweak colors or layout.
