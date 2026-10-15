import { createHash } from "node:crypto";
import { sqliteTable, text, integer, blob, index, customType } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  signaturePng: text("signature_png"),
  disabledAt: integer("disabled_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const document = sqliteTable("document", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["pdf", "html"] }).notNull().default("pdf"),
  pdf: blob("pdf"),
  htmlSource: text("html_source"),
  contentHash: text("content_hash"),
  status: text("status", { enum: ["draft", "sent", "completed", "cancelled", "declined"] }).notNull().default("draft"),
  version: integer("version").notNull().default(0),
  cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
  cancelReason: text("cancel_reason"),
  declinedAt: integer("declined_at", { mode: "timestamp" }),
  declineReason: text("decline_reason"),
  signedPdf: blob("signed_pdf"),
  signedHtml: text("signed_html"),
  // Webhook URL to POST when all required signers have signed.
  webhookUrl: text("webhook_url"),
  // If true, send email notifications to signers (default). API can set to false.
  notify: integer("notify", { mode: "boolean" }).notNull().default(true),
  // IANA timezone for seal timestamps in signed artifacts (e.g. Europe/Helsinki).
  auditTimezone: text("audit_timezone"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const field = sqliteTable("field", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["text", "textarea", "checkbox", "signature", "date", "hetu"] }).notNull(),
  // Coords only used for kind="pdf" docs (where the recipient sees the rendered
  // PDF and the field is overlaid). For kind="html" docs the field is a real
  // form element in the HTML source; coords are null.
  page: integer("page"),
  x: integer("x"),
  y: integer("y"),
  width: integer("width"),
  height: integer("height"),
  name: text("name"),
  label: text("label"),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  value: text("value"),
  // True when the document owner pre-filled this field before sending.
  // Pre-filled fields are baked into the signer's view as disabled, and the
  // sign API ignores any tampered submissions for them.
  prefilled: integer("prefilled", { mode: "boolean" }).notNull().default(false),
  // If true, this field is private to the signer (e.g. a personal identity code) and must
  // not be visible to other signers. Private fields are masked in others' views
  // and are only included in the final PDF delivered to the owner.
  privateForOtherSigners: integer("private_for_other_signers", { mode: "boolean" }).notNull().default(false),
  // For multi-signer docs: which signer this field is assigned to (null = all signers).
  assignedToSignerEmail: text("assigned_to_signer_email"),
  assignedSignerKey: text("assigned_signer_key"),
});

export const signingSession = sqliteTable("signing_session", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  signerKey: text("signer_key"),
  token: text("token").notNull().unique(),
  signedAt: integer("signed_at", { mode: "timestamp" }),
  declinedAt: integer("declined_at", { mode: "timestamp" }),
  declineReason: text("decline_reason"),
  signedIp: text("signed_ip"),
  signedUserAgent: text("signed_user_agent"),
  // Set by the Resend webhook when the recipient clicks the "Review & sign"
  // link in the invitation email. More reliable than open tracking (Apple
  // Mail Privacy Protection rules out opens). Only set once — first click.
  linkClickedAt: integer("link_clicked_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  // For documents with multiple signers: the order in which this signer should
  // sign (0-based). Null = no enforced order (all signers can sign in parallel).
  signerOrder: integer("signer_order"),
  // Whether to email this signer their invite (set from send-time notify precedence).
  inviteEmailEnabled: integer("invite_email_enabled", { mode: "boolean" }).notNull().default(true),
});

export const apiKey = sqliteTable("api_key", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: ["admin", "regular"] }).notNull().default("regular"),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
}, (table) => [index("api_key_owner_idx").on(table.ownerUserId)]);

export const rateLimitBucket = sqliteTable("rate_limit_bucket", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

// Hash Better Auth's IP/path keys on writes and query parameters alike.
const hashedRateLimitKey = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => createHash("sha256").update(value).digest("hex"),
});

// Better Auth stores millisecond timestamps as numbers, not Date objects.
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: hashedRateLimitKey("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const setupClaim = sqliteTable("setup_claim", {
  id: text("id").primaryKey(),
  claimedAt: integer("claimed_at", { mode: "timestamp" }),
  userId: text("user_id"),
});
