import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Config } from "../config.js";

export interface EmailAttachment {
  filename: string;
  /** Base64 file bytes, sent as an attachment rather than a public URL. */
  content: string;
}
export interface Message {
  to: string;
  cc?: string[];
  headers?: Record<string,string>;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}
export interface EmailDelivery {
  configured: boolean;
  send(message: Message, id: string): Promise<string>;
  getMessageId?(providerId: string): Promise<string | null>;
}
export function seal(message: Message, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(message), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(".");
}
export function unseal(value: string, key: string): Message {
  const [iv, tag, ciphertext] = value.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(iv, "hex"),
  );
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(ciphertext, "hex")),
      cipher.final(),
    ]).toString(),
  );
}
export class ResendDelivery implements EmailDelivery {
  constructor(private config: Config) {}
  get configured() {
    return !!(
      this.config.emailDeliveryEnabled !== false &&
      this.config.emailApiKey &&
      this.config.emailFrom &&
      this.config.emailEncryptionKey
    );
  }
  async send(message: Message, id: string) {
    if (!this.configured)
      throw new Error("Email is not configured");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${this.config.emailApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: JSON.stringify({
        from: this.config.emailFromName
          ? `${this.config.emailFromName} <${this.config.emailFrom}>`
          : this.config.emailFrom,
        to: [message.to],
        ...(message.cc?.length ? {cc:message.cc} : {}),
        ...(message.headers ? {headers:message.headers} : {}),
        subject: message.subject,
        text: message.text,
        ...(message.html ? {html:message.html} : {}),
        ...(message.attachments?.length ? {attachments:message.attachments.map(({filename,content})=>({filename,content}))} : {}),
        ...(this.config.emailReplyTo ? {reply_to:this.config.emailReplyTo} : {}),
      }),
    });
    // Provider bodies may contain recipient information. Never log them.
    if (!response.ok) throw new Error("Email provider rejected delivery");
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error("Email provider response invalid");
    return body.id;
  }
  async getMessageId(providerId:string) {
    if (!this.configured) throw new Error("Email is not configured");
    const response=await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`,{
      signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${this.config.emailApiKey}`},
    });
    if(!response.ok)throw new Error("Email reference lookup failed");
    const body=await response.json() as {message_id?:string};
    return /^<[^<>\s]+@[^<>\s]+>$/.test(body.message_id??'')?body.message_id!:null;
  }
}
