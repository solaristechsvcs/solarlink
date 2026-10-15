# SolarLink 🌌

Cosmic link-in-bio website with Discord OAuth2 login, Node.js, Express and external MySQL.

## Wisp / Pterodactyl deployment

1. Use a **Node.js 20+** server/egg (Node.js 22 LTS recommended) with an allocated HTTP port.
2. Upload repository files or clone the repository into the Wisp server.
3. Import `schema.sql` into an **external MySQL** database (the session table is created automatically).
4. Edit `config.js` on the Wisp server to enter your domain, Discord credentials, MySQL connection, and session secret. The repository only contains placeholders. **Never commit real secrets.**
5. In Discord Developer Portal > OAuth2, register exactly `https://YOUR-DOMAIN/auth/discord/callback` as a redirect URI and configure client ID/secret. Only the `identify` scope is needed.
6. Point your domain's HTTPS reverse proxy to the allocated Wisp port. Set `server.baseUrl` to the public HTTPS origin and `discord.redirectUri` to the matching callback in `config.js`. Set `server.trustProxy` to `true` only behind a trusted reverse proxy.
7. Install dependencies with `npm install`. Startup command: **`npm start`** (or main file `server.js` if the egg launches Node directly).
8. Check `/health` and then test Discord login.

Wisp startup templates differ; set `server.port` in `config.js` to the Wisp allocated port, and that outbound connections to Discord and your MySQL host are allowed.

## Routes
- `/auth/discord` — start Discord login
- `/auth/discord/callback` — OAuth2 callback
- `POST /auth/logout` — log out
- `GET /api/me` — authenticated profile
- `PUT /api/me` — save authenticated profile
- `GET /api/profile/:username` — public profile JSON
- `GET /health` — database health check

Profile editing requires a logged-in session. The website's initial client-only preview is being integrated with these endpoints.

## Security
Session data is stored in MySQL. Discord access tokens are used only to fetch identity, not persisted. Cookies are HTTP-only, secure on HTTPS, and SameSite=Lax. Mutating endpoints check Origin. Protect your database credentials and `session.secret` in `config.js`. Do not commit real credentials.

## Staff administration and upgrade of an existing MySQL installation

Back up the database and your deployed `config.js` first. Stop SolarLink in Wisp while applying schema changes. Keep your existing domain, proxy route/IP, allocated port, Discord OAuth settings, session secret and MySQL settings in `config.js`; do not overwrite them with repository placeholders or commit them.

1. Deploy the updated files from `main`, preserving the server's `config.js`.
2. For an existing database, run `migration_001_appearance.sql` **only if those four appearance columns have not already been installed**, then run `migration_002_staff.sql` once using your MySQL administration tool. These migrations are not repeatable. For a new database, import `schema.sql`, then migrations 001 and 002 in order. Do not reimport the base schema as a substitute for migrations. All tables must use InnoDB.
3. Install dependencies (`npm install`) and start the app (`npm start`) using the existing Wisp allocation and HTTPS proxy. Check `/health`. A health response checks database connectivity; it does not verify migrations. Check Discord login and profile save as well.
4. Log in once with the Discord account that should be the initial administrator. Obtain its numeric Discord user ID (Discord Developer Mode → Copy User ID); do not use a display name or profile username.
5. In the Wisp console/terminal with the same deployed `config.js`, run `node bootstrap-admin.js YOUR_NUMERIC_DISCORD_ID`. This local database-operator command creates an audit entry and refuses when an active admin already exists. It never restores suspended accounts. It is also the operator recovery command if no active admins remain. No public bootstrap endpoint or automatic first-user promotion exists.
6. Open `/staff` or the **Staff panel** navigation link. Search for users and assign additional admins/staff as needed. No new login is required for role changes. Test the checklist below before reopening service fully.

`GET /api/staff/users?q=...&page=1` lists 50 users per page; `GET /api/staff/audit` returns the most recent 100 actions. `POST /api/staff/users/:id/suspend`, `/restore`, and `/role` require JSON with a nonempty `reason` (max 500 characters), plus `value` for role changes. All staff API paths require a live active staff/admin account. Mutations also require the configured public Origin. Roles are always loaded from MySQL, never accepted from profile updates or cached in session.

Staff can suspend/restore ordinary users; only admins can assign roles or moderate other staff/admins. Nobody may moderate their own account. The last active admin cannot be suspended or demoted. Transactions serialize moderation changes and store the audit row atomically with the change. A failed audit write rolls back the change. Suspensions block authenticated account requests and new OAuth logins, and hide public profiles. Discord identity and profile data remain intact for restoration. Audit records retain numeric actor/target IDs without cascading deletion; the panel is read-only for history. Database operators retain direct database access, so protect those credentials and back up audit history.

Public profiles are available at `/?u=USERNAME`. Active staff and admins both display a **Staff** badge sourced from their current database role. Saved appearance settings and Discord avatar fallback are included. Admins can share a profile URL without exposing private moderation status or audit details.

Validation: run `npm test` and `npm run check`. Before production use, check with separate ordinary/staff/admin accounts: ordinary users cannot open `/staff` or any `/api/staff` path; staff cannot change roles or act on staff; admins cannot act on themselves; suspended sessions immediately lose API access; restore recovers access; cross-origin/missing-Origin mutations are rejected; profile saves cannot change roles; public badges disappear after demotion; audit records show successful changes. Confirm Discord OAuth, profile creation, and image/banner/background/accent settings on your actual HTTPS Wisp deployment. Automated tests use database doubles; they do not replace this MySQL/OAuth smoke test.

To roll back application code, stop the app first and restore the previous release while preserving `config.js`. Older releases do not enforce suspensions; do not run them publicly while relying on moderation. Retain schema additions and audit history, or restore the database backup offline if necessary.

## Shareable profile URLs

After saving a profile, the preview shows its public URL and a **Copy profile link** button. For example, username `xenosphinx` is available at `https://link.solaristechsvcs.com/xenosphinx`. Visitors do not need to log in; the profile displays every saved link in order, appearance settings and any Staff badge. The earlier `/?u=USERNAME` URLs still work. Missing and suspended profiles return 404. Application names `api`, `auth`, `staff`, and `health` are reserved; accounts using those names should choose another username.

This update needs no database migration or config changes. Deploy the updated application files (including `profiles.js`) and restart SolarLink in Wisp. The HTTPS reverse proxy must forward username paths such as `/xenosphinx` to the same Node application as `/`; no extra DNS record is required. Existing saved profiles immediately receive their username URLs.
