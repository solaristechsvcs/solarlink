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
