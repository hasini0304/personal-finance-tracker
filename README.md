## Supabase Authentication Setup

Pennywise uses Supabase Authentication with the official `@supabase/supabase-js` client. The browser client requires only the project URL and a public publishable key (or legacy anon key); never put a `service_role` key in a Vite variable or any client-side file.

1. Create a Supabase project and open **Project Settings → API**.
2. Copy the project URL and its public publishable key (or legacy anon key) into a local `.env.local` file in the project root:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-public-publishable-or-anon-key
   ```

   `.env.local` is ignored by Git. `.env.example` shows the required variable names without credentials.
3. In **Authentication → URL Configuration**, set the Site URL to your app URL and allow that URL as a redirect URL. Add your local Vite URL (usually `http://localhost:5173`) and the deployed app URL as needed; password-reset links return to the app origin.
4. In **Authentication → Providers → Email**, enable email/password sign-in and choose whether email confirmation is required.
5. Install dependencies with `npm install`, then start the app with `npm run dev`. Restart Vite after changing environment variables.

Registration, login, reset-link requests, password updates from recovery links, and sign-out are handled by Supabase. Passwords are submitted directly to Supabase over HTTPS and are not stored by this app. Authentication sessions persist using the Supabase client's browser storage. Finance records remain in the existing LocalStorage implementation for this phase and are not yet scoped to a Supabase user; that is part of the planned data-migration phase.