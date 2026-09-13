import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { relayEvent } from "../index.js";

const WEBHOOK = "https://discord.com/api/webhooks/1/abc";
const KEY = "sk-or-test";

// "Sat, 13 Sep 2026 05:51:53 +0800", normalised to UTC by postal-mime.
const MIME = [
  "From: Anthropic <no-reply@mail.anthropic.com>",
  "To: simplelogin-a@vspo.me",
  "Subject: Your secure link to Claude.ai is here",
  "Date: Sat, 13 Sep 2026 05:51:53 +0800",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "Sign in to Claude.ai using this magic link (expires in 10 minutes).",
  "",
  "Your secure link to Claude.ai is here",
  "[https://claude.ai/login/magic?token=abc123]",
  "",
  "If you did not request this, ignore.",
  "",
].join("\r\n");

function message(overrides = {}) {
  return {
    from: "no-reply@mail.anthropic.com",
    to: "simplelogin-a@vspo.me",
    rawSize: MIME.length,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(MIME));
        controller.close();
      },
    }),
    ...overrides,
  };
}

let calls;

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes("openrouter")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "```md\n[Sign in](https://claude.ai/login/magic?token=abc123)\n```" } }] }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  delete globalThis.fetch;
});

const discord = () => calls.find((c) => c.url.includes("discord.com"));
const openrouter = () => calls.find((c) => c.url.includes("openrouter"));

describe("relayEvent", () => {
  it("parses MIME, rewrites it, and posts one embed", async () => {
    await relayEvent(message(), { DISCORD_WEBHOOK_URL: WEBHOOK, OPENROUTER_API_KEY: KEY });

    expect(calls).toHaveLength(2);

    const ai = openrouter();
    expect(ai.body.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(ai.body.provider).toEqual({ order: ["BaseTen"] });
    expect(ai.body.reasoning).toEqual({ effort: "none" });
    expect(ai.body.messages[1].content).toContain("magic?token=abc123");

    const payload = discord().body;
    expect(payload.username).toBe("Email Relay");
    expect(payload.allowed_mentions).toEqual({ parse: [] });

    const embed = payload.embeds[0];
    expect(embed.author.name).toBe("Anthropic <no-reply@mail.anthropic.com>");
    expect(embed.title).toBe("Your secure link to Claude.ai is here");
    expect(embed.description).toBe("[Sign in](https://claude.ai/login/magic?token=abc123)");
    expect(embed.fields[0]).toEqual({
      name: "To",
      value: "simplelogin-a@vspo.me",
      inline: true,
    });
    expect(embed.fields[1].value).toBe("2026-09-13 05:51 CST");
    expect(embed.fields).toHaveLength(2);
  });

  it("falls back to linkified plain text when the model call fails", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      if (String(url).includes("openrouter")) return new Response("boom", { status: 503 });
      return new Response("{}", { status: 200 });
    });

    await relayEvent(message(), { DISCORD_WEBHOOK_URL: WEBHOOK, OPENROUTER_API_KEY: KEY });

    expect(discord().body.embeds[0].description).toBe(
      "Sign in to Claude.ai using this magic link (expires in 10 minutes).\n\n" +
        "[Your secure link to Claude.ai is here](https://claude.ai/login/magic?token=abc123)\n\n" +
        "If you did not request this, ignore.",
    );
  });

  it("skips the model call when there is no key", async () => {
    await relayEvent(message(), { DISCORD_WEBHOOK_URL: WEBHOOK });
    expect(calls).toHaveLength(1);
    expect(discord().body.embeds[0].description).toContain(
      "[Your secure link to Claude.ai is here](https://claude.ai/login/magic?token=abc123)",
    );
  });

  it("does nothing without a webhook", async () => {
    await relayEvent(message(), { OPENROUTER_API_KEY: KEY });
    expect(calls).toHaveLength(0);
  });

  it("skips oversized messages before parsing", async () => {
    await relayEvent(message({ rawSize: 6 * 1024 * 1024 }), {
      DISCORD_WEBHOOK_URL: WEBHOOK,
      OPENROUTER_API_KEY: KEY,
    });
    expect(calls).toHaveLength(0);
  });

  it("lists attachment filenames", async () => {
    const withAttachment = MIME.replace(
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/plain; charset="utf-8"\n\nbody here\n--b\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="invoice.pdf"\nContent-Transfer-Encoding: base64\n\nJWh0dHA=\n--b--',
    );
    const raw = new TextEncoder().encode(withAttachment);
    await relayEvent(
      message({
        rawSize: raw.length,
        raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }),
      }),
      { DISCORD_WEBHOOK_URL: WEBHOOK },
    );

    const embed = discord().body.embeds[0];
    expect(embed.description).toBe("body here");
    expect(embed.fields[2].value).toBe("📎 invoice.pdf");
  });
});
