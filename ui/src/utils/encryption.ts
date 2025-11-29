import { ethers } from 'ethers';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function deriveKeyBytes(key: string, length: number): Uint8Array {
  const normalizedKey = ethers.getAddress(key);
  const keyBytes = ethers.getBytes(normalizedKey);
  const derived = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    derived[index] = keyBytes[index % keyBytes.length];
  }
  return derived;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

function hexToBytes(payload: string): Uint8Array {
  const value = payload.startsWith('0x') ? payload.slice(2) : payload;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export function encryptContentWithKey(content: string, key: string): `0x${string}` {
  if (content.length === 0) {
    return '0x';
  }
  const plainBytes = encoder.encode(content);
  const derivedKey = deriveKeyBytes(key, plainBytes.length);
  const encrypted = new Uint8Array(plainBytes.length);
  for (let index = 0; index < plainBytes.length; index += 1) {
    encrypted[index] = plainBytes[index] ^ derivedKey[index];
  }
  return bytesToHex(encrypted);
}

export function decryptContentWithKey(payload: string, key: string): string {
  if (!payload || payload === '0x') {
    return '';
  }
  const cipherBytes = hexToBytes(payload);
  const derivedKey = deriveKeyBytes(key, cipherBytes.length);
  const decrypted = new Uint8Array(cipherBytes.length);
  for (let index = 0; index < cipherBytes.length; index += 1) {
    decrypted[index] = cipherBytes[index] ^ derivedKey[index];
  }
  return decoder.decode(decrypted);
}
