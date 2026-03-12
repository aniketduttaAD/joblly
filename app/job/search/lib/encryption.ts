import CryptoJS from "crypto-js";

const ENCRYPTION_KEY = "jobifier-local-key";

/**
 * Encrypts data using AES-256
 */
export function encrypt(data: string): string {
  return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
}

/**
 * Decrypts data using AES-256
 */
export function decrypt(encryptedData: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Encrypts an object by stringifying and encrypting
 */
export function encryptObject<T>(obj: T): string {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypts and parses an object
 */
export function decryptObject<T>(encryptedData: string): T {
  return JSON.parse(decrypt(encryptedData));
}
