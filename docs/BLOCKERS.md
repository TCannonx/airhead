# Blockers

## Waiting for the user

### 1. Create the Supabase projects (needed from Task 1.4 on)

1. Go to https://supabase.com/dashboard and sign in (GitHub sign-in is fine).
2. **New project** → organisation: your personal one → name `airhead-dev` → set a strong database password and keep it in your password manager → region **West EU (Ireland)** → plan **Free** → **Create new project**.
3. Repeat for `airhead-live`.
4. For each project, open **Project Settings → General** and note the **Project ID** (the "ref", about 20 letters).
5. Create a personal access token: avatar (top right) → **Account preferences → Access Tokens** → **Generate new token** → name `airhead-ci`. Copy it once; it is shown only once.
6. In this terminal, link the dev project yourself so no secret passes through chat:
   - `! npx supabase login` (paste the token when asked)
   - `! npx supabase link --project-ref <airhead-dev ref>` (enter the dev database password when asked)
7. Create `.env.local` in the repo root (git-ignored) using `.env.example`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from the dev project's **Project Settings → API** (the publishable/anon key, not the service key); `SUPABASE_PROJECT_REF_DEV` is the dev ref.
8. Tell Claude Code "Supabase projects are created". GitHub secrets for the deploy workflows are listed in Task 1.8.

### 2. Anthropic API key with a spend limit (needed from Phase 3)

Plan setup step 2. Create it in the Claude Console with a monthly spend limit. Don't paste it anywhere yet; it goes into Supabase secrets in Phase 3.
