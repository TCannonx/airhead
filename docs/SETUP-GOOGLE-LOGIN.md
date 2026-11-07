# Setting up "Sign in with Google" for Airhead

Airhead uses Google **only as a login** (name and email). It never asks for calendar, Drive or Gmail access.
Do this once for `airhead-dev`, then repeat the Supabase part for `airhead-live` when you go live.

Menu names in Google Cloud change from time to time. If a label below doesn't match exactly, look for the closest equivalent.

## 1. Find your Supabase callback URL

1. Open the Supabase dashboard → project **airhead-dev**.
2. Go to **Authentication → Sign In / Providers → Google**.
3. Copy the **Callback URL** shown there. It looks like
   `https://<project-ref>.supabase.co/auth/v1/callback`

Keep this tab open.

## 2. Create a Google Cloud project

1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Use the project picker at the top → **New project** → name it `Airhead` → **Create**.
3. Make sure the new project is selected.

## 3. Set up the consent screen

Google calls this the **OAuth consent screen** or **Google Auth Platform** (Branding / Audience / Data access).

1. App name: `Airhead`. User support email: your email. Developer contact: your email.
2. Audience / user type: **External**.
3. Scopes / data access: only the defaults, **openid**, **email** and **profile**. Add nothing else.
4. Test users: add your own Google account (and later your girlfriend's, if she ever gets a login).
5. Because Airhead only uses basic scopes, you can leave it in **Testing** for personal use, or **Publish** it. Basic scopes don't need Google verification.

## 4. Create the OAuth client

1. Go to **Credentials** (or **Clients**) → **Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `Airhead web`.
3. **Authorised JavaScript origins** — add:
   - `http://localhost:5173` (local development)
   - the dev site address `https://airhead.xxr5th.workers.dev`
4. **Authorised redirect URIs** — add the Supabase **Callback URL** from step 1.
5. **Create**, then copy the **Client ID** and **Client secret**.

## 5. Turn on Google in Supabase

1. Back in Supabase → **Authentication → Sign In / Providers → Google**.
2. Enable it, paste the **Client ID** and **Client secret**, and save.
3. Go to **Authentication → URL Configuration**:
   - **Site URL**: `https://airhead.xxr5th.workers.dev`.
   - **Redirect URLs**: add `http://localhost:5173/**`, `https://airhead.xxr5th.workers.dev/**` and `https://*-airhead.xxr5th.workers.dev/**` (preview builds).

## 6. Tell Claude Code it's done

In `docs/BLOCKERS.md`, tick the Google login item, or just tell Claude Code: "Google login is set up for dev."
Never paste the client secret into chat or into the repo. It belongs only in the Supabase dashboard.

## Going live later

Repeat **step 5** in the `airhead-live` project. In Google Cloud, add the live callback URL to the same client's redirect URIs, and add the live site address to the JavaScript origins.
