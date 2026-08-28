# MT-Aigis Telemetry Worker

This directory contains an isolated Cloudflare Worker and D1 database for three
coarse, privacy-minimized MT-Aigis usage counters:

- total distinct installations ever observed;
- distinct active installations for the current UTC day;
- installations that sent a heartbeat within the last 12 minutes.

These values are approximate installation counts, not verified people. One
person using multiple Macs, or deleting the application's local data and
reinstalling it, can be counted more than once. The public heartbeat endpoint
can also be imitated, so the values must not be treated as audit-grade data.

## Data boundary

The client generates its installation identifier locally and sends only its
64-character lowercase hexadecimal SHA-256 hash as `installationHash`. D1
stores that hash and its latest server-side heartbeat time so totals and recent
presence can be deduplicated. It also retains the hash-to-day relationship only
for the current UTC day; a daily scheduled task deletes older relationships
while keeping their aggregate daily counts.

The Worker does not read or store DMM accounts, cookies, hardware identifiers,
locale, viewed pages, other application activity, or IP addresses. It does not
write request data to logs, and Workers observability and invocation logs are
disabled in `wrangler.jsonc`.

Cloudflare still processes network connection metadata as the infrastructure
provider. This service only ensures that the Worker code and D1 schema do not
read or persist that metadata.

## API

### Record a heartbeat

```http
POST /v1/heartbeat
Content-Type: application/json

{"installationHash":"<64 lowercase hexadecimal characters>"}
```

A valid heartbeat returns the same aggregate JSON payload as `GET /v1/stats`.
The client should send one after telemetry starts and then every five minutes.
The request must be asynchronous, must not delay game loading, and should fail
silently without rapid retries.

The server uses its own clock. Repeated heartbeats from the same installation
do not increase the total installation or current UTC daily-active count.

### Read statistics

```http
GET /v1/stats
```

Example response:

```json
{
  "totalInstallations": 120,
  "dailyActive": 32,
  "onlineNow": 7,
  "dayUtc": "2026-08-27",
  "heartbeatIntervalSeconds": 300,
  "onlineWindowSeconds": 720,
  "generatedAt": "2026-08-27T12:34:56.000Z"
}
```

`onlineNow` is a rolling estimate: an installation may remain counted for up to
12 minutes after it loses its network connection or closes unexpectedly.

## Deploy

The production Worker is deployed at
`https://mt-aigis-telemetry.mt-aigis-telemetry-worker.workers.dev`. The checked-in
D1 database ID is a public resource identifier, not a credential. Wrangler
authentication remains outside the repository in the operator's macOS Keychain.

For a fresh deployment in another Cloudflare account, create and bind the
resources explicitly:

1. Enter this directory and install its isolated development dependency:

   ```sh
   npm install
   ```

2. Authenticate Wrangler with the intended Cloudflare account:

   ```sh
   npx wrangler login
   ```

3. Create the D1 database:

   ```sh
   npx wrangler d1 create mt-aigis-telemetry
   ```

4. Replace the existing `database_id` in `wrangler.jsonc` with the database ID
   returned for the new account.

5. Apply the D1 migration remotely:

   ```sh
   npm run db:migrate:remote
   ```

6. Deploy the Worker:

   ```sh
   npm run deploy
   ```

For local development, apply the local migration with
`npm run db:migrate:local`, then run `npm run dev`.

The Worker endpoint is intentionally public because a secret embedded in an
open-source desktop application would not provide authentication. Strict input
validation and idempotent writes limit accidental duplication, but they cannot
make public counters resistant to deliberate fabrication.
