import assert from "node:assert/strict";
import { test } from "node:test";
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from "../server/notify/webpush.ts";

const enc = new TextEncoder();
const B = (u: Uint8Array) => u as BufferSource;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", B(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: B(salt), info: B(info) }, key, bytes * 8));
}

test("aes128gcm: получатель расшифровывает сообщение (RFC 8291)", async () => {
  // Ключи «браузера».
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));

  const message = JSON.stringify({ title: "Вам назначена задача", body: "Проверить кассу" });
  const out = await encryptPayload(enc.encode(message), b64urlEncode(uaPublic), b64urlEncode(auth));

  const salt = out.slice(0, 16);
  const rs = new DataView(out.buffer, out.byteOffset + 16, 4).getUint32(0);
  const idlen = out[20]!;
  const asPublic = out.slice(21, 21 + idlen);
  const ciphertext = out.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);

  const asKey = await crypto.subtle.importKey("raw", B(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", B(cek), "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: B(nonce) }, key, B(ciphertext)));
  assert.equal(plain.at(-1), 2, "разделитель последней записи");
  assert.equal(new TextDecoder().decode(plain.slice(0, -1)), message);
});

test("VAPID: подпись ES256 проверяется открытым ключом", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const header = await vapidAuthorization("https://push.example.com/send/abc", b64urlEncode(pub), jwk.d!, "mailto:admin@example.com");
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m);
  const [h, c, sig] = m[1]!.split(".");
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c!)));
  assert.equal(claims.aud, "https://push.example.com");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, B(b64urlDecode(sig!)), enc.encode(`${h}.${c}`));
  assert.equal(ok, true);
});
