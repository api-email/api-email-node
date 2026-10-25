export interface ApiEmailErrorInit {
  /** HTTP status; `null` when no response arrived. */
  status: number | null;
  /** The API's error code, or `connection_error`, `timeout`, `missing_api_key`, `http_error`. */
  code: string;
  message: string;
  hint?: string | undefined;
  requestId?: string | undefined;
  cause?: unknown;
}

/** Every failed API call throws this. */
export class ApiEmailError extends Error {
  override readonly name = 'ApiEmailError';
  readonly status: number | null;
  readonly code: string;
  readonly hint?: string;
  readonly requestId?: string;

  constructor(init: ApiEmailErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    if (init.hint !== undefined) this.hint = init.hint;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }
}

export type WebhookVerificationReason = 'malformed_header' | 'timestamp_out_of_tolerance' | 'signature_mismatch' | 'invalid_json';

/** `verifyWebhook` throws this when a delivery can't be trusted. */
export class WebhookVerificationError extends Error {
  override readonly name = 'WebhookVerificationError';
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
