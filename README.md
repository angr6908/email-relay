# email-discord-relay

Inbound email → Discord embed, on Cloudflare Email Routing and Workers.

Mail arrives at the domain's Cloudflare MX records, a routing rule invokes the
Worker, and the Worker gets the raw MIME message directly in its `email()`
handler. It parses the message, asks an LLM for a one-sentence digest, and
posts a Discord embed. Nothing is forwarded and nothing is stored.

## Why Workers

The previous deployment received a webhook with metadata only, so the function
had to call back to the mail provider to fetch the body, and the provider's
webhook queue sat in front of that. Here the body is already in hand, which
removes a round trip and a queue hop.

## Deploy

The dashboard editor resolves no npm packages, so paste the bundle, not
`index.js`:

```bash
npm install
npm run build          # dist/worker.js, self-contained
```

Paste `dist/worker.js` into the Worker's code editor and deploy, then add the
secrets below under Settings → Variables and Secrets. Rebuild and re-paste after
any edit to `index.js`.

To deploy from the CLI instead:

```bash
npx wrangler login
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler deploy
```

Then, in the dashboard for the routed domain: **Email Routing → Manage →
Routing rules → add a rule** (or edit the catch-all) with the action **Send
email to a Worker**, pointing at `email-discord-relay`. The Worker's name must
match `wrangler.jsonc`.

Mail is only delivered once that rule exists. The `email()` export is the
entry point; no binding is configured in `wrangler.jsonc`.

## Configuration

| Secret | |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | required; without it the message is dropped |
| `OPENROUTER_API_KEY` | optional; without it the embed carries the plain-text body |
| `AI_MODEL` | optional; defaults to `deepseek/deepseek-v4-flash-0731` |

Model requests pin the `BaseTen` provider with fallbacks enabled, so an outage at
that host degrades to another rather than dropping the digest. Messages above
5 MB are skipped rather than parsed.

## Behaviour notes

* `To` shows the envelope recipient, which is the alias address for mail that
  arrives through a forwarding alias.
* `Date` comes from the sender's `Date` header, normalised to UTC by
  `postal-mime` and rendered as fixed UTC+8. It is the send time, not the
  receive time.
* If the model call fails or is unconfigured, the embed falls back to the
  email's text, with `Label [https://url]` patterns folded into Markdown links.
* Mail with only an HTML part is converted to text. Anchors become Markdown
  links so magic-link URLs survive; `head` and pre-body content is dropped.
* `allowed_mentions` is emptied: email content is untrusted and must not ping
  anyone.

## Test

```bash
npm test
```

`test/format.test.js` pins the text-handling functions to the output of the
previous Rust implementation, including its quirks. `test/relay.test.js` runs a
real MIME message through the handler with the network stubbed and asserts the
Discord payload.
