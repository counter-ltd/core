# Thing Two gateway bot

Replies when the bot is **@mentioned** in Discord (e.g. `@Thing Two hi`). Slash
commands (`/ask`, `/interact`, `/post`) still live in the Worker API; this
service exists only because @mentions are normal messages, which arrive over
Discord's Gateway (a persistent WebSocket) rather than the HTTP interactions
webhook. It answers with the same Vertex AI model as `/ask`.

Runs as a single always-on Cloud Run instance. It holds one Gateway connection,
so **max instances must be 1** or you get duplicate replies.

## How it authenticates

No key file. On Cloud Run the runtime service account is used via Application
Default Credentials. That account needs `roles/aiplatform.user` (the project's
compute default SA already has it). The Discord bot token is passed as an env
var (or a Secret Manager secret).

## Intents

`Guilds` + `GuildMessages` + **`MessageContent`**. The bot answers with the last
few messages of the channel as context, and reading that history needs the
privileged Message Content intent.

Toggle it on once: Discord Developer Portal → your app → **Bot** → **Privileged
Gateway Intents** → enable **Message Content Intent** → save. No verification is
required under 100 servers. Without it, login fails with a "disallowed intents"
error.

The bot still only *acts* on messages that mention it; the history fetch happens
on demand at that moment and is never stored, so nothing is logged or retained
about non-mention traffic.

## Deploy

From `apps/bot/`, build and deploy from source (Cloud Build does the container):

```sh
gcloud run deploy counter-bot \
  --source . \
  --project=plated-monolith-494022-f4 \
  --region=us-central1 \
  --min-instances=1 \
  --max-instances=1 \
  --no-cpu-throttling \
  --no-allow-unauthenticated \
  --set-env-vars=GCP_PROJECT=plated-monolith-494022-f4,VERTEX_LOCATION=us-central1,VERTEX_MODEL=google/gemini-2.5-flash,DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
```

`--set-env-vars` must be a single flag: gcloud keeps only the last occurrence,
so splitting it across two flags silently drops the first set. Or use
`../../scripts/deploy-bot.sh`, which handles this.

Why these flags:

- `--min-instances=1` keeps the WebSocket alive (no scale-to-zero).
- `--max-instances=1` guarantees a single Gateway connection (no double replies).
- `--no-cpu-throttling` keeps CPU allocated between requests, so heartbeats keep
  firing and Discord doesn't drop the socket.
- `--no-allow-unauthenticated` since nothing should hit the health endpoint.

### Token as a secret (recommended over env)

```sh
printf '%s' 'YOUR_BOT_TOKEN' | gcloud secrets create discord-bot-token --data-file=- --project=plated-monolith-494022-f4
# then deploy with --set-secrets=DISCORD_BOT_TOKEN=discord-bot-token:latest  (drop it from --set-env-vars)
```

## Local run

```sh
DISCORD_BOT_TOKEN=... GCP_PROJECT=plated-monolith-494022-f4 \
  GOOGLE_APPLICATION_CREDENTIALS=../../../private/GoogleServiceAccount.json \
  npm start
```

Locally ADC needs a credential, so point `GOOGLE_APPLICATION_CREDENTIALS` at the
service-account JSON. On Cloud Run that variable is unset and ADC uses the
attached runtime SA instead.
