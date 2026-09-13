import { describe, expect, it } from "vitest";

import { __test } from "../index.js";

const { buildEmbed, cleanAiText, formatCst, htmlToText, linkifyPlainText, truncate } = __test;

// Expectations are the output of the Rust implementation in the previous
// repo, so the rewrite keeps producing identical embeds.
describe("truncate", () => {
  it("matches the reference", () => {
    expect(truncate("hello", 256)).toBe("hello");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate("exactly10c", 10)).toBe("exactly10c");
    expect(truncate("no bracket here at all", 8)).toBe("no brac…");
    expect(truncate("日本語のテキストです", 5)).toBe("日本語の…");
    expect(truncate("prefix [dangling", 14)).toBe("prefix …");
  });

  it("does not split a masked link", () => {
    const s = "see [label](https://example.com/x) now";
    expect(truncate(s, 12)).toBe("see …");
    expect(truncate(s, 20)).toBe("see …");
  });
});

describe("linkifyPlainText", () => {
  it("folds bracketed urls into masked links", () => {
    expect(linkifyPlainText("Click here\n[https://example.com/a?b=1]")).toBe(
      "[Click here](https://example.com/a?b=1)",
    );
    expect(linkifyPlainText("Reset password [ https://example.com/reset(1) ]")).toBe(
      "[Reset password](https://example.com/reset%281%29)",
    );
    expect(linkifyPlainText("  [https://example.com/bare]")).toBe("https://example.com/bare");
    expect(linkifyPlainText("plain text with no links")).toBe("plain text with no links");
    expect(linkifyPlainText("A [https://a.test] and B [https://b.test]")).toBe(
      "[A](https://a.test)[and B](https://b.test)",
    );
    expect(
      linkifyPlainText(
        "line1\nA very long label that goes on and on and on and on and on and on and on and on [https://x.test]",
      ),
    ).toBe(
      "line1\n[A very long label that goes on and on and on and on and on and on and on and on](https://x.test)",
    );
  });
});

describe("cleanAiText", () => {
  it("strips fences and masks urls", () => {
    expect(cleanAiText("```markdown\nHello **world** https://example.com/verify\n```")).toBe(
      "Hello **world** [Open link](https://example.com/verify)",
    );
    expect(cleanAiText("```\njust fenced\n```")).toBe("just fenced");
    expect(cleanAiText("no urls here")).toBe("no urls here");
  });

  it("leaves existing markdown links alone", () => {
    expect(cleanAiText("Visit [site](https://example.com/a) and https://example.com/b.")).toBe(
      "Visit [site](https://example.com/a) and [Open link](https://example.com/b).",
    );
    expect(cleanAiText("mixed [a](https://a.test) then https://b.test, end")).toBe(
      "mixed [a](https://a.test) then [Open link](https://b.test), end",
    );
  });

  it("moves trailing punctuation outside the link", () => {
    expect(cleanAiText("Trailing punctuation https://example.com/x?y=1!")).toBe(
      "Trailing punctuation [Open link](https://example.com/x?y=1)!",
    );
    expect(cleanAiText("url in parens (https://c.test) done")).toBe(
      "url in parens ([Open link](https://c.test)) done",
    );
  });
});

describe("formatCst", () => {
  it("shifts to utc plus eight", () => {
    expect(formatCst("2026-08-27T14:24:00.000Z")).toBe("2026-08-27 22:24 CST");
    expect(formatCst("2026-01-01T16:00:00Z")).toBe("2026-01-02 00:00 CST");
    expect(formatCst("2026-08-27 14:24:00.000000+00")).toBe("2026-08-27 22:24 CST");
    expect(formatCst("not a date")).toBe("not a date");
    expect(formatCst("")).toBe("");
  });

  it("applies a positive utc offset", () => {
    expect(formatCst("2026-08-27T14:24:00+02:00")).toBe("2026-08-27 20:24 CST");
  });

  it("applies a negative half-hour utc offset", () => {
    expect(formatCst("2026-08-27T14:24:00-03:30")).toBe("2026-08-28 01:54 CST");
  });

  it("treats a naive stamp as utc, not machine-local", () => {
    expect(formatCst("2026-08-27 14:24:00")).toBe("2026-08-27 22:24 CST");
  });

  it("matches a real Date header normalised by postal-mime", () => {
    // "Sat, 13 Sep 2026 05:51:53 +0800" parses to UTC and comes back to CST.
    expect(formatCst("2026-09-12T21:51:53.000Z")).toBe("2026-09-13 05:51 CST");
  });
});

describe("htmlToText", () => {
  it("reduces markup to readable text", () => {
    expect(
      htmlToText(
        '<html><head><style>a{color:red}</style></head><body><p>Hello</p><p>World &amp; co&nbsp;</p></body></html>',
      ),
    ).toBe("Hello\n\nWorld & co");
  });

  it("keeps a single newline for a line break", () => {
    expect(htmlToText("line1<br>line2")).toBe("line1\nline2");
  });

  // A stripped anchor would hide the one-time URL, which is the whole point of
  // the email. These pin that it survives.
  it("keeps link targets as markdown links", () => {
    expect(
      htmlToText('<p><a href="https://x.test/magic?t=1&amp;e=2">Sign in</a></p>'),
    ).toBe("[Sign in](https://x.test/magic?t=1&e=2)");
    expect(htmlToText('<a href="https://x.test/a(1)">y</a>')).toBe("[y](https://x.test/a%281%29)");
    expect(htmlToText('<a href="https://x.test/i"><img src="p.png" alt="banner"></a>')).toBe(
      "https://x.test/i",
    );
    expect(htmlToText('<a href="#top">Skip to content</a>')).toBe("Skip to content");
  });

  // Real mail (pixiv security notices) nests <a> tags with missing closers.
  it("resolves nested anchors innermost-first", () => {
    expect(
      htmlToText('<a href="https://o.test">outer <a href="https://i.test">inner</a> tail</a>'),
    ).toBe("outer [inner](https://i.test) tail");
    expect(htmlToText('<a href="https://o.test">unclosed outer <a href="https://i.test">in')).toBe(
      "unclosed outer in",
    );
  });

  it("keeps query strings in unquoted hrefs", () => {
    expect(htmlToText("<a href=https://x.test/m?a=1&b=2 class=btn>go</a>")).toBe(
      "[go](https://x.test/m?a=1&b=2)",
    );
  });

  it("does not repeat a url that is already its own label", () => {
    expect(htmlToText('<a href="https://claude.ai/help">https://claude.ai/help</a>')).toBe(
      "https://claude.ai/help",
    );
  });

  it("drops style and script blocks spanning lines", () => {
    expect(htmlToText("<style>\n.a{content:'<p>'}\n</style><p>real</p>")).toBe("real");
    expect(htmlToText("<script>\nvar a = '<p>';\n</script><p>real</p>")).toBe("real");
  });

  it("drops head and pre-body chrome", () => {
    const doc =
      "<!DOCTYPE html><html><head><title>Confirm your email</title>" +
      "<meta charset=utf-8><style>body{margin:0}</style></head>" +
      '<body style="margin:0"><p>Tap to confirm</p></body></html>';
    expect(htmlToText(doc)).toBe("Tap to confirm");
  });

  it("keeps the link when the head is present", () => {
    const doc =
      "<html><head><title>x</title></head><body><a href='https://x.test/m?a=1&amp;b=2'>Go</a></body></html>";
    expect(htmlToText(doc)).toBe("[Go](https://x.test/m?a=1&b=2)");
  });
});

describe("buildEmbed", () => {
  const base = {
    from: "sender@example.com",
    to: "me@example.com",
    subject: "Hi",
    date: "2026-08-27T14:24:00.000Z",
    text: "body",
    attachments: ["a.pdf"],
  };

  it("renders the reference shape", () => {
    const embed = buildEmbed(base, null);
    expect(embed.author.name).toBe("sender@example.com");
    expect(embed.title).toBe("Hi");
    expect(embed.description).toBe("body");
    expect(embed.fields[0]).toEqual({ name: "To", value: "me@example.com", inline: true });
    expect(embed.fields[1].value).toBe("2026-08-27 22:24 CST");
    expect(embed.fields[2].value).toBe("📎 a.pdf");
  });

  it("prefers the rewrite when there is one", () => {
    expect(buildEmbed(base, "rewritten").description).toBe("rewritten");
  });

  it("falls back when the email is empty", () => {
    const embed = buildEmbed(
      { from: "", to: "", subject: "", date: "", text: "", attachments: [] },
      null,
    );
    expect(embed.title).toBe("(no subject)");
    expect(embed.description).toBe("*(no content)*");
    expect(embed.fields[0].value).toBe("(unknown)");
    expect(embed.author).toBeUndefined();
    expect(embed.fields).toHaveLength(2);
  });
});
