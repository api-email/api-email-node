import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index';

describe('public exports', () => {
  it('exposes exactly the documented runtime API', () => {
    expect(Object.keys(sdk).sort()).toEqual(['ApiEmail', 'ApiEmailError', 'VERSION', 'WebhookVerificationError', 'verifyWebhook']);
  });
});
