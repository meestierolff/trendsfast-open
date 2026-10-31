/**
 * The sealed key `trendsfast login` receives, version 1.
 *
 * The CLI makes an X25519 key pair and sends only the public half. After the owner signs in,
 * TrendsFast issues a project key and seals it to that public key: it makes an ephemeral
 * X25519 pair, derives an AES-256-GCM key with HKDF-SHA256 over the shared secret (salt: the
 * ephemeral public key, then the CLI's; info `trendsfast-cli-login-v1`) and encrypts the
 * credential with the login's `state` as associated data. The browser, its history and any
 * chat the code passes through only ever hold the sealed form, which opens only with the
 * private key on this machine and only for this login.
 *
 * Layout: `version (1) ‖ ephemeral public key (32) ‖ nonce (12) ‖ ciphertext ‖ tag (16)`,
 * base64url without padding. The server repository's interop test imports
 * `openCliCredential` to open what its sealer produces.
 */
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

export const CLI_LOGIN_SEAL_VERSION = 1;
export const CLI_LOGIN_HKDF_INFO = "trendsfast-cli-login-v1";
const HEADER = 1 + 32 + 12;
const TAG = 16;

export interface CliCredential {
  v: 1;
  api_key: string;
  key_id: string;
  project_id: string;
  project_name: string;
  scopes: string[];
  expires_at: string | null;
}

export class SealError extends Error {
  constructor(
    readonly reason:
      | "malformed"
      | "version"
      | "public_key"
      | "low_order"
      | "decrypt"
      | "payload",
  ) {
    super(`The sealed sign-in could not be opened (${reason}).`);
    this.name = "SealError";
  }
}

export interface LoginKeyPair {
  privateKey: KeyObject;
  /** The raw 32-byte public key, base64url without padding: the JWK `x`. */
  publicKey: string;
}

export function generateLoginKeyPair(): LoginKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKey, publicKey: publicKey.export({ format: "jwk" }).x! };
}

/** A fresh login state: 32 random bytes, base64url (43 characters). */
export function generateLoginState(): string {
  return randomBytes(32).toString("base64url");
}

/** The private key as JWK fields, for the pending code-flow file (0600). */
export function exportPrivateKey(privateKey: KeyObject): { d: string; x: string } {
  const jwk = privateKey.export({ format: "jwk" });
  return { d: jwk.d!, x: jwk.x! };
}

export function importPrivateKey(fields: { d: string; x: string }): KeyObject {
  return createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: fields.d, x: fields.x }, format: "jwk" });
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function isCredential(value: unknown): value is CliCredential {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.api_key === "string" &&
    v.api_key.length > 0 &&
    typeof v.key_id === "string" &&
    typeof v.project_id === "string" &&
    typeof v.project_name === "string" &&
    Array.isArray(v.scopes) &&
    v.scopes.every((scope) => typeof scope === "string") &&
    (v.expires_at === null || typeof v.expires_at === "string")
  );
}

/**
 * Opens a version-1 sealed credential.
 *
 * @param privateKey the CLI's X25519 private key for this login
 * @param publicKeyRaw the CLI's public key: raw 32 bytes, or their base64url
 * @param state the login's state, bound as associated data
 * @param sealed what arrived as `sealed` (or the code the browser showed)
 */
export function openCliCredential(
  privateKey: KeyObject,
  publicKeyRaw: Uint8Array | string,
  state: string,
  sealed: string,
): CliCredential {
  const text = sealed.trim();
  if (!BASE64URL.test(text)) throw new SealError("malformed");
  const bytes = Buffer.from(text, "base64url");
  if (bytes.length < HEADER + TAG + 1) throw new SealError("malformed");
  if (bytes[0] !== CLI_LOGIN_SEAL_VERSION) throw new SealError("version");
  const ephemeral = bytes.subarray(1, 33);
  const nonce = bytes.subarray(33, HEADER);
  const tag = bytes.subarray(bytes.length - TAG);
  const ciphertext = bytes.subarray(HEADER, bytes.length - TAG);
  const cliPublic = typeof publicKeyRaw === "string" ? Buffer.from(publicKeyRaw, "base64url") : Buffer.from(publicKeyRaw);
  if (cliPublic.length !== 32) throw new SealError("public_key");

  let shared: Buffer;
  try {
    const ephemeralKey = createPublicKey({
      key: { kty: "OKP", crv: "X25519", x: Buffer.from(ephemeral).toString("base64url") },
      format: "jwk",
    });
    shared = diffieHellman({ privateKey, publicKey: ephemeralKey });
  } catch {
    throw new SealError("public_key");
  }
  // An all-zero secret means a low-order point: anyone could compute it.
  if (shared.length !== 32 || shared.every((byte) => byte === 0)) throw new SealError("low_order");

  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeral, cliPublic]), CLI_LOGIN_HKDF_INFO, 32));
  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(state, "utf8"));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new SealError("decrypt");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new SealError("payload");
  }
  if (!isCredential(parsed)) throw new SealError("payload");
  return parsed;
}
