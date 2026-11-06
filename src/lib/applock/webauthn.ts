import type { AppLockAuthenticator } from '../auth/types';
import { fromBase64Url, toBase64Url } from './lock';

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function friendly(e: unknown): Error {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return new Error('Face ID / Touch ID was cancelled or timed out.');
  }
  return new Error('Face ID / Touch ID did not work. Try again.');
}

/**
 * Face ID / Touch ID through a WebAuthn platform credential. The assertion is
 * checked only on the device (user verification succeeded); there is no
 * server round-trip, because the lock is a privacy screen, not a login.
 */
export const webAuthnAppLock: AppLockAuthenticator = {
  async available() {
    if (typeof PublicKeyCredential === 'undefined') return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  async register(label) {
    try {
      const credential = (await navigator.credentials.create({
        publicKey: {
          rp: { name: 'Airhead', id: window.location.hostname },
          user: { id: random(16), name: label, displayName: label },
          challenge: random(32),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 }, // ES256
            { type: 'public-key', alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'discouraged',
          },
          timeout: 60_000,
          attestation: 'none',
        },
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error('No credential returned');
      return toBase64Url(credential.rawId);
    } catch (e) {
      throw friendly(e);
    }
  },

  async verify(credentialId) {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: random(32),
          allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) }],
          userVerification: 'required',
          timeout: 60_000,
        },
      });
      if (!assertion) throw new Error('No assertion returned');
    } catch (e) {
      throw friendly(e);
    }
  },
};
