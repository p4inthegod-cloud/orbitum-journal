# OKX journal integration

Open **Journal → Connect OKX** while signed in. Create a dedicated API key with only **Read** permission, and enter its API Key, Secret Key and Passphrase in that form. Select the account's registration region and live or OKX Demo Trading. The local journal demonstration mode does not accept exchange credentials.

The initial connection imports currently open **linear USDT SWAP and FUTURES** positions. Subsequent snapshots update quantity, weighted entry, leverage, mark price and native unrealized P&L. Full closing results come from OKX position history, including its `realizedPnl` (fees/funding already included). Spot, inverse contracts and other settlement currencies are counted as unsupported instead of being converted into fabricated USD results.

## Synchronization and lifecycle

- The visible journal requests synchronization every 10 seconds. Supabase pg_cron reconciles in the background every minute, using the existing Vercel function. This release uses REST snapshots, not a permanent private WebSocket connection.
- A database lease prevents simultaneous background/browser writes. Disconnecting/replacing a connection invalidates its lease; late requests cannot write into the new connection.
- Instrument, position ID, side, creation time and account namespace identify each lifecycle. Confirmed reopenings get a new identity even if OKX reuses `posId`. Repeating a snapshot does not create duplicates.
- Partial closes update the remaining position. Missing positions remain pending until a full-close history record with actual realized P&L confirms closing. Completed lifecycles between polls are recovered from history after the connection date.
- Exchange mark/P&L values expire after 30 seconds. Failed requests never refresh their reception time. Missing/ambiguous orders are not invented; retained levels are marked unconfirmed if the order request fails. Protective stops beyond entry retain their real price, even when a traditional risk/reward scale cannot be drawn.
- Full-position TP/SL conditional/OCO orders are matched by instrument, position side, margin mode, closing direction and quantity. Partial/multiple different target orders are not collapsed into a fictional single target.
- Imported financial fields are server managed. Owners may add journal notes; synchronization preserves them. Clearing manual journal entries keeps imported records. Disconnecting deletes stored credentials and preserves history.

## Server and database

`/api/okx` is rewritten to the shared journal entrypoint (`api/journal-tg.js`), which dispatches to `lib/okx-api.js` separately from the existing Telegram handler. The project keeps 12 functions within the current hosting limit. OKX uses the existing `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` server variables. No OKX keys are embedded in source, environment variables, analytics, browser storage or API responses. A key is transiently held by the connection form and cleared after submission/closing.

The shared journal function is deployed in Singapore (`sin1`), near the Sydney database; other functions keep their existing placement. The OKX REST host is selected separately from the account's registration region.

Credentials are stored in Supabase Vault with authenticated encryption. `public.okx_connections` has RLS and no browser grants/policies; the deliberate default deny is appropriate for this server-only table. The SQL RPC is SECURITY INVOKER, executable only by `service_role`, and checks that role. Every user endpoint verifies its bearer token through Auth before choosing the owner. The client cannot choose another owner. Exchange calls use GET-only endpoint and regional host allowlists, bounded requests and safe error codes.

The migration installs `okx-journal-sync` in pg_cron. It sends an authenticated request to `https://www.orbitum.trade/api/okx` only when connected accounts need reconciliation. Its random authentication token stays in Vault. HTTP request/response tables are not readable by browser roles; orphaned connection secrets are cleaned after account deletion. A request processes up to six due accounts with three workers; larger deployments should use a dedicated queue/worker.

## Verification

Node tests cover contracts, signs, partial/full closing, reused position IDs, backfill, idempotency, order matching, API signing, endpoint restrictions, permissions and owner authorization. A database transaction verifies Vault roundtrip, upserts, note preservation, blocked browser financial changes, credential deletion and rollback. Browser verification covers connection form, import, native P&L, notes, stale prices, failure/disconnect and both themes from 320 to 1905 px.

The account-specific live roundtrip requires its owner to enter a Read-only OKX key through the site. Credentials should never be sent through chat.

Sources: [OKX API v5](https://www.okx.com/docs-v5/en/), [regional REST domains](https://www.okx.com/docs-v5/log_en/#2026-05-20), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
