import { describe, expect, it } from 'vitest';
import { isPushEndpoint, pushSubscriptionSchema } from './notifications.js';

describe('isPushEndpoint', () => {
  it('accepte les adresses des services de push des navigateurs', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
  });

  it('refuse ce qui viserait le réseau interne', () => {
    expect(isPushEndpoint('http://192.168.1.1/admin')).toBe(false);
    expect(isPushEndpoint('https://192.168.1.201:8888/x')).toBe(false);
    expect(isPushEndpoint('https://[::1]/x')).toBe(false);
    expect(isPushEndpoint('https://db/x')).toBe(false);
    expect(isPushEndpoint('https://nas.local/x')).toBe(false);
    expect(isPushEndpoint('https://127.0.0.1/x')).toBe(false);
  });

  it('refuse ce qui n’est pas HTTPS', () => {
    expect(isPushEndpoint('http://push.example.org/a')).toBe(false);
    expect(isPushEndpoint('pas une adresse')).toBe(false);
  });

  it('le schéma d’abonnement porte la règle', () => {
    const keys = { p256dh: 'k', auth: 'a' };
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://push.example.org/a', keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'http://192.168.1.1/a', keys }).success).toBe(false);
  });
});
