import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  signaturePng: text("signature_png"),
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
  status: text("status", { enum: ["draft", "sent", "completed"] }).notNull().default("draft"),
  signedPdf: blob("signed_pdf"),
  signedHtml: text("signed_html"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const field = sqliteTable("field", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["text", "textarea", "checkbox", "signature"] }).notNull(),
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
});

export const signingSession = sqliteTable("signing_session", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  token: text("token").notNull().unique(),
  signedAt: integer("signed_at", { mode: "timestamp" }),
  signedIp: text("signed_ip"),
  signedUserAgent: text("signed_user_agent"),
  // Set by the Resend webhook when the recipient clicks the "Review & sign"
  // link in the invitation email. More reliable than open tracking (Apple
  // Mail Privacy Protection rules out opens). Only set once — first click.
  linkClickedAt: integer("link_clicked_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
