import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS_FR, googleLoginSchema } from './index.js';

describe('googleLoginSchema', () => {
  it('refuse un jeton vide ou blanc', () => {
    expect(googleLoginSchema.safeParse({ credential: '' }).success).toBe(false);
    expect(googleLoginSchema.safeParse({ credential: '   ' }).success).toBe(false);
  });
  it('accepte un jeton quelconque non vide', () => {
    expect(googleLoginSchema.parse({ credential: 'abc.def.ghi' }).credential).toBe('abc.def.ghi');
  });
});

describe('ACCOUNT_STATUS_LABELS_FR', () => {
  it('couvre les trois états', () => {
    expect(ACCOUNT_STATUSES).toHaveLength(3);
    for (const s of ACCOUNT_STATUSES) expect(ACCOUNT_STATUS_LABELS_FR[s]).toBeTruthy();
  });
});
