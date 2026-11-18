# XSpace Gate Control — Supabase rebuild

This branch contains the Supabase-based replacement for the earlier Apps Script scanner. The existing `main` branch is not changed.

## Scope
- Entry and Exit staff sign in through Supabase Auth.
- Staff role is read from `staff_profiles`, never trusted from the browser.
- Entry changes `OUTSIDE → INSIDE`; duplicate entry is rejected.
- Exit changes `INSIDE → OUTSIDE`; duplicate exit is rejected.
- The scan operation is one PostgreSQL transaction and locks the ticket row to prevent two phones accepting the same transition concurrently.
- Admin dashboard reads ticket counts, ticket inventory, and scan history through role-checked RPC functions.
- No ticket IDs or QR values are generated or changed by this code.

## Existing database
The following tables are expected to exist in `public`:
- `staff_profiles(user_id, email, full_name, role, is_active, created_at)`
- `tickets(ticket_id, qr_value, status, created_at, updated_at)`
- `scan_history(id, ticket_id, scanned_value, action, outcome, reason, staff_user_id, scanned_at)`

RLS must be enabled on all three. Direct table privileges for `anon` and `authenticated` should remain revoked. The SQL functions in `supabase/001_secure_scan_functions.sql` are SECURITY DEFINER functions with explicit role checks and restricted execute grants.

## Required one-time Supabase configuration
1. In Supabase SQL Editor, run the full contents of `supabase/001_secure_scan_functions.sql`.
2. In Supabase Authentication, create the first user account.
3. Promote that user to ADMIN using the bootstrap SQL below, replacing the email and name with the exact account details:
   ```sql
   insert into public.staff_profiles (user_id, email, full_name, role, is_active)
   select id, email, 'XSpace Administrator', 'ADMIN', true
   from auth.users
   where lower(email) = lower('YOUR_ADMIN_EMAIL')
   on conflict (user_id) do update
     set email = excluded.email,
         full_name = excluded.full_name,
         role = 'ADMIN',
         is_active = true;
   ```
   This statement affects only the specified user's profile. Do not expose credentials in GitHub.
4. In Project Settings → API, copy the Project URL and the public anon/publishable key. Put them in `config.js` on the deployment branch. Never use a `service_role` or secret key in browser code.
5. Enable GitHub Pages for the intended branch (Settings → Pages → Deploy from branch → root folder).
6. Open the HTTPS GitHub Pages site and test with a non-production ticket first.

## Important notes
- The first ADMIN account must exist in Supabase Auth before its profile can be promoted. A repository commit cannot create an Auth user in your private Supabase project.
- The current UI supports sign-in, role-based scanner access, admin summary, inventory display, and recent scan history. It does not yet expose staff provisioning or CSV import screens.
- Existing EVT001–EVT200 QR data must be imported unchanged into `tickets`. Do not regenerate QR images or replace the existing QR payloads. A data export/CSV is needed to preserve the exact values.
- Do not switch the live GitHub Pages site to this branch until Supabase configuration and tests are complete.
- The old Apps Script implementation remains in the original `main` branch for rollback/reference; this branch does not call it.
