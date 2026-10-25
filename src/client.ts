import { ApiEmailError } from './errors';
import { HttpClient, type ClientOptions } from './http';
import { Emails } from './resources/emails';

/** The api.email API client. `new ApiEmail()` reads the key from `API_EMAIL_KEY`. */
export class ApiEmail {
  readonly emails: Emails;

  constructor(apiKey?: string, options: ClientOptions = {}) {
    const key = (apiKey ?? readEnvKey())?.trim();
    if (!key) {
      throw new ApiEmailError({
        status: null,
        code: 'missing_api_key',
        message: 'No API key: pass it to new ApiEmail(key) or set API_EMAIL_KEY',
      });
    }
    const http = new HttpClient(key, options);
    this.emails = new Emails(http);
  }
}

function readEnvKey(): string | undefined {
  try {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    return g.process?.env?.API_EMAIL_KEY;
  } catch {
    return undefined; // e.g. Deno without --allow-env
  }
}
