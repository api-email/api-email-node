// Field names match the API one to one (https://api.email/docs/api), in snake_case.

export type EmailStatus = 'queued' | 'scheduled' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'canceled';

export interface Attachment {
  filename: string;
  /** Bytes (Buffer, Uint8Array, ArrayBuffer), or a string that is already base64-encoded. */
  content: string | Uint8Array | ArrayBuffer;
  content_type: string;
}

/** POST /v1/emails (https://api.email/docs/sending). At least one of `text` and `html` is required. */
export type SendEmailParams = {
  /** An address on a verified domain, optionally with a name: `Acme <hello@acme.com>`. */
  from: string;
  /** Up to 50 recipients. */
  to: string | string[];
  subject: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  headers?: Record<string, string>;
  attachments?: Attachment[];
  tags?: string[];
  /** Up to 30 days ahead. A `Date` is sent as ISO 8601. */
  scheduled_at?: string | Date;
  track_opens?: boolean;
  track_clicks?: boolean;
} & ({ text: string; html?: string } | { html: string; text?: string });

export interface SendEmailResponse {
  id: string;
  status: 'queued' | 'scheduled';
  scheduled_at?: string;
}

export interface Email {
  id: string;
  status: EmailStatus;
  from: string;
  to: string[];
  subject: string;
  created_at: string;
  scheduled_at?: string;
  tags?: string[];
  events?: { type: EmailEventType; at: string }[];
}

export interface ListEmailsParams {
  status?: EmailStatus;
  to?: string;
  tag?: string;
  cursor?: string;
}

/** POST /v1/domains (https://api.email/docs/domains). */
export interface CreateDomainParams {
  name: string;
  /** Prefix of the sending subdomain, `send` by default. */
  return_path?: string;
}

export type DomainStatus = 'pending' | 'verified' | 'failed';

export interface DomainRecord {
  type: 'CNAME';
  name: string;
  value: string;
  status?: DomainStatus;
}

export interface Domain {
  id: string;
  name: string;
  status: DomainStatus;
  records: DomainRecord[];
}

/** POST /v1/routes (https://api.email/docs/inbound). */
export interface CreateRouteParams {
  /** An address, or a catch-all such as `*@in.acme.com`. */
  match: string;
  /** The URL each matching message is POSTed to. */
  forward: string;
}

export interface CreatedRoute {
  id: string;
  /** Signs every delivery from this route. Store it like a password. */
  secret: string;
}

export interface Route {
  id: string;
  match: string;
  forward: string;
}

export interface InboundAttachment {
  filename: string;
  content_type: string;
  size: number;
  /** Download it with `inbound.attachment()` or your API key; kept for 7 days. */
  url: string;
}

/** A received message: GET /v1/inbound/{id}, and the body of `email.received` deliveries. */
export interface InboundEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  /** Only the new part of a reply, without the quoted thread or signature. */
  reply_text?: string;
  /** The id of the email you sent, when the message replies to it. */
  in_reply_to?: string | null;
  /** All message headers, lower-cased. */
  headers: Record<string, string>;
  attachments: InboundAttachment[];
  auth: { spf: string; dkim: string; dmarc: string };
  received_at: string;
}

export type EmailEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked';

export type WebhookEventType = EmailEventType | 'email.received';

/** POST /v1/webhooks (https://api.email/docs/webhooks). */
export interface CreateWebhookParams {
  url: string;
  events: WebhookEventType[];
}

export interface CreatedWebhook {
  id: string;
  /** Signs every event sent to this endpoint. Store it like a password. */
  secret: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventType[];
}

/** A sending event. `id` identifies the event: store it to skip duplicates. */
export interface EmailEvent {
  type: EmailEventType;
  id: string;
  email_id: string;
  to: string;
  at: string;
  tags?: string[];
  /** Present on bounces and complaints. */
  reason?: string;
}

export interface EmailReceivedEvent extends InboundEmail {
  type: 'email.received';
}

export type WebhookEvent = EmailEvent | EmailReceivedEvent;

/** One page of a list endpoint. No `next_cursor` (or `null`) means the last page. */
export interface Page<T> {
  data: T[];
  next_cursor?: string | null;
}
