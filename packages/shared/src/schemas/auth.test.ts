import { describe, expect, it } from 'vitest';
import { googleLoginSchema, updateAccountRoleSchema } from './index.js';

describe('googleLoginSchema', () => {
  it('refuse un jeton vide ou blanc', () => {
    expect(googleLoginSchema.safeParse({ credential: '' }).success).toBe(false);
    expect(googleLoginSchema.safeParse({ credential: '   ' }).success).toBe(false);
  });
  it('accepte un jeton quelconque non vide', () => {
    expect(googleLoginSchema.parse({ credential: 'abc.def.ghi' }).credential).toBe('abc.def.ghi');
  });
});

describe('updateAccountRoleSchema', () => {
  it('n’accepte que les deux rôles connus', () => {
    expect(updateAccountRoleSchema.parse({ role: 'ADMIN' }).role).toBe('ADMIN');
    expect(updateAccountRoleSchema.parse({ role: 'MEMBER' }).role).toBe('MEMBER');
    expect(updateAccountRoleSchema.safeParse({ role: 'SUPERADMIN' }).success).toBe(false);
    expect(updateAccountRoleSchema.safeParse({}).success).toBe(false);
  });
});
