// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Transactional email the API sends, and the one helper for escaping
 * user-supplied text into the HTML bodies.
 *
 * Both messages go out through the Cloudflare Email Sending binding. Callers
 * run them best-effort (out of band, errors swallowed): an email is never on
 * the critical path of the request that triggers it, so a mail hiccup must not
 * fail an account deletion or a registration.
 */
import type { EmailBinding } from '../types.ts';

const FROM = { email: 'noreply@counter.ltd', name: 'Counter' };

/**
 * Escape the few characters that matter before dropping a user-supplied name
 * into an HTML body, so a display name can't inject markup.
 */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/**
 * Email a fresh account written confirmation of the address, with a link that
 * verifies it when clicked.
 *
 * Verifying is optional. It earns the ✦ badge and nothing more, so the email
 * sells it as trust, not a hoop: the account already works unverified.
 *
 * @param email  The Email Sending binding.
 * @param to     The address to confirm.
 * @param name   What to greet them by (display name, falling back to username).
 * @param link   The verify URL carrying the one-time token.
 */
export async function sendVerificationEmail(
  email: EmailBinding,
  to: string,
  name: string,
  link: string,
): Promise<void> {
  const text =
    `Hi ${name},\n\n` +
    `Confirm this email to add a verified badge to your Counter profile. It's ` +
    `optional, your account already works, but a verified address is one more ` +
    `signal that you're a real person:\n\n${link}\n\n` +
    `The link is good for 24 hours. If you didn't create a Counter account, you ` +
    `can ignore this; nothing will happen.\n\n— Counter`;
  const safe = escapeHtml(name);
  const html =
    `<p>Hi ${safe},</p>` +
    `<p>Confirm this email to add a verified badge to your Counter profile. It's ` +
    `optional, your account already works, but a verified address is one more ` +
    `signal that you're a real person.</p>` +
    `<p><a href="${link}">Verify my email</a></p>` +
    `<p>The link is good for 24 hours. If you didn't create a Counter account, you ` +
    `can ignore this; nothing will happen.</p>` +
    `<p>— Counter</p>`;
  await email.send({ to, from: FROM, subject: 'Verify your Counter email', text, html });
}

/**
 * Email the user written confirmation that their account is gone.
 *
 * The license (Condition 6) requires confirming a deletion to the User in
 * writing; this is the durable version of the on-screen notice.
 *
 * @param email  The Email Sending binding.
 * @param to     The address to confirm to, captured before the row was deleted.
 * @param name   What to greet them by (display name, falling back to username).
 */
export async function sendDeletionConfirmation(
  email: EmailBinding,
  to: string,
  name: string,
): Promise<void> {
  const text =
    `Hi ${name},\n\n` +
    `Your Counter account and all associated personal data have been permanently ` +
    `deleted: your posts, likes, reposts, follows, sessions, and themes. Media is ` +
    `purged from storage within 24 hours.\n\n` +
    `Anonymous, aggregate view counts that can't identify you may remain, as ` +
    `described in our data disclosure at https://counter.ltd/data.\n\n` +
    `If you didn't request this, contact us right away.\n\n` +
    `Thanks for having been here.\n— Counter`;
  const safe = escapeHtml(name);
  const html =
    `<p>Hi ${safe},</p>` +
    `<p>Your Counter account and all associated personal data have been permanently ` +
    `deleted: your posts, likes, reposts, follows, sessions, and themes. Media is ` +
    `purged from storage within 24 hours.</p>` +
    `<p>Anonymous, aggregate view counts that can't identify you may remain, as ` +
    `described in our <a href="https://counter.ltd/data">data disclosure</a>.</p>` +
    `<p>If you didn't request this, contact us right away.</p>` +
    `<p>Thanks for having been here.<br>— Counter</p>`;
  await email.send({
    to,
    from: FROM,
    subject: 'Your Counter account has been deleted',
    text,
    html,
  });
}
