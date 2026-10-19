# Last.fm MCP

A read-only Last.fm MCP server on Cloudflare Workers, bringing listening history and music taste insights to AI assistants.

## First version

One tool, `get_listening_profile`, returns top artists and tracks with numeric play counts and ranks. It defaults to `rmlowe` through `LASTFM_DEFAULT_USER`; an optional `username` selects another accessible profile. The API key identifies the application, not the profile owner. No Last.fm user login or shared secret is needed for these read methods.

| Argument | Default | Allowed values |
| --- | --- | --- |
| `username` | Configured owner | Last.fm username |
| `period` | `overall` | `overall`, `7day`, `1month`, `3month`, `6month`, `12month` |
| `artistLimit` | 30 | Integer 1–50 |
| `trackLimit` | 50 | Integer 1–100 |

Each call makes two requests to Last.fm, fetching only page 1. Results include the selected user/period, retrieval time and separate chart coverage (`returned`, `totalEntries`, `page`, `perPage`, `totalPages`, `truncated`). Totals count chart entries, not total scrobbles. Counts describe recorded listening in the selected Last.fm window; they do not measure all listening or prove an artist is unfamiliar. `overall` and recent windows overlap. No percentages of total listening are inferred from these bounded charts.

This is a chart snapshot, not a raw scrobble history API or recommendation engine. The assistant interprets it. No database, scheduled collection, automatic pagination, retries or persistent cache. If either chart fails, the tool reports an error instead of a misleading partial profile. Valid empty charts remain a successful empty result.

Example prompts:

- “Compare my overall and last month's listening, then suggest five artists to explore. Explain the connections and don't assume missing artists are new to me.”
- “What distinguishes my last 12 months from my all-time favourites?”

## Development

Use Node.js 24 or newer.

```sh
npm ci
npm test
npm run build
```

For local live testing, create an ignored `.dev.vars` file:

```dotenv
LASTFM_API_KEY=your-api-key
MCP_AUTH_MODE=bearer
MCP_AUTH_TOKEN=your-random-token-of-at-least-32-characters
LASTFM_DEFAULT_USER=rmlowe
```

Run `npm run dev` and connect an MCP client to `http://localhost:8787/mcp` with `Authorization: Bearer <your token>`. Do not commit the file or paste credentials into issues or chat. The shared secret is unused and should not be added to the Worker.

Tests use offline fixtures: data validation, error sanitization, bounded requests, MCP handshake/tool calls, signed Access JWTs and native workerd request options. They do not validate live Last.fm data or a deployed client's OAuth flow. CI runs installation, dependency audit, tests and a deployment dry run; it does not deploy.

Dependencies and scoped MCP overrides start from the tested TfL Worker lockfile. The overrides keep the Agents package's transitive MCP client/SDK on the patched versions used there. Review these overrides when upgrading Agents. Binary install approvals cover the pinned esbuild and workerd versions; update them alongside those packages if npm asks.

## Deploy and connect

The checked-in configuration uses `MCP_AUTH_MODE=disabled`: all requests return 404 until authentication is configured. The Worker verifies authentication independently of the Access edge. Preview URLs are explicitly disabled.

1. Authenticate with `npx wrangler login`.
2. Run `npx wrangler secret put LASTFM_API_KEY` and enter the API key privately. Allow Wrangler to create `lastfm-mcp` if prompted.
3. Run `npm run deploy` to publish the disabled Worker and obtain its hostname.
4. In Cloudflare, create a **separate Access application** for the Last.fm Worker hostname, protecting all paths. Apply your existing approved-user policy if appropriate. Enable managed OAuth as with the TfL application and configure the callback URLs for your MCP clients.
5. Copy this application's **AUD tag**. Do not reuse the TfL or Home Climate AUD. In `wrangler.jsonc`, set:

   ```json
   "vars": {
     "MCP_AUTH_MODE": "access",
     "MCP_ACCESS_TEAM_DOMAIN": "https://YOUR-TEAM.cloudflareaccess.com",
     "MCP_ACCESS_AUD": "YOUR-LASTFM-APPLICATION-AUD",
     "LASTFM_DEFAULT_USER": "rmlowe"
   }
   ```

6. Run `npm run deploy` again. Add `https://<your-worker-hostname>/mcp` to your MCP client and sign in through Access.
7. Ask for your top artists and tracks for `1month`, then `overall`. Compare the first few names and counts against your Last.fm profile for those periods. Confirm that the returned user is `rmlowe`, coverage is reported, and the cross-period recommendation prompt works.

Keep the authentication variables in Wrangler configuration so later deployments preserve them. The team domain includes `https://` and no trailing slash. The AUD and team domain are configuration, not secrets. The API key stays in the Worker secret store. Connecting additional clients may require adding their callback URLs to the Access application's managed OAuth settings.

Access mode accepts only signed `Cf-Access-Jwt-Assertion` tokens with the configured issuer/audience, RS256 signature and valid required expiry/issued-at/subject claims. Opaque OAuth bearer tokens are handled by Access at the edge; there is no shared-token fallback in Access mode. Missing or invalid configuration fails closed. Browser requests with a different Origin are denied, and responses use `private, no-store`.

Last.fm requests use a fixed HTTPS host, a 10-second timeout per request and manual redirect handling (redirects are rejected). Upstream errors, including API errors sent with HTTP 200, are sanitized; keys and raw errors are never intentionally logged or returned. Observability is disabled by default because API keys are query parameters upstream. Artist and track names must be treated as untrusted data, never assistant instructions.

## References

- [Last.fm user.getTopArtists](https://www.last.fm/api/show/user.getTopArtists)
- [Last.fm user.getTopTracks](https://www.last.fm/api/show/user.getTopTracks)
- [Last.fm API terms](https://www.last.fm/api/tos)
- [TfL Worker](https://github.com/rmlowe/tfl-mcp), the basis for the MCP transport and authentication
