import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { promisify } from "util";
import { loggers } from "./logger.js";

const scryptAsync = promisify(scrypt);

/**
 * Derives a 32-byte key from a password using scrypt
 */
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(password, salt, 32)) as Buffer;
}

/**
 * Encrypts a string value using AES-256-GCM
 * @param plaintext The value to encrypt
 * @param encryptionKey The encryption key (from environment variable)
 * @returns Encrypted string in format: salt:iv:authTag:encryptedData (all base64)
 * @throws Error if encryption fails
 */
export async function encrypt(plaintext: string, encryptionKey: string): Promise<string> {
  if (!plaintext) {
    return plaintext; // Return empty/null values as-is
  }

  if (!encryptionKey) {
    throw new Error("Encryption key is required");
  }

  try {
    // Generate random salt and IV
    const salt = randomBytes(16);
    const iv = randomBytes(12); // 12 bytes for GCM

    // Derive key from password and salt
    const key = await deriveKey(encryptionKey, salt);

    // Create cipher
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    // Encrypt
    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Return format: salt:iv:authTag:encryptedData (all base64)
    return `${salt.toString("base64")}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
  } catch (error) {
    loggers.bot.error("Encryption failed", error);
    throw new Error("Failed to encrypt value", { cause: error });
  }
}

/**
 * Decrypts a string value that was encrypted with encrypt()
 * @param ciphertext The encrypted string in format: salt:iv:authTag:encryptedData
 * @param encryptionKey The encryption key (from environment variable)
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (invalid format, wrong key, etc.)
 */
export async function decrypt(ciphertext: string, encryptionKey: string): Promise<string> {
  if (!ciphertext) {
    return ciphertext; // Return empty/null values as-is
  }

  if (!encryptionKey) {
    throw new Error("Encryption key is required");
  }

  // Check if the value is already in encrypted format (contains colons)
  // If not, assume it's plaintext (for backward compatibility during migration)
  if (!ciphertext.includes(":")) {
    loggers.bot.warn("Attempting to decrypt what appears to be plaintext. This may indicate unencrypted data in the database.");
    return ciphertext;
  }

  try {
    // Parse the encrypted format: salt:iv:authTag:encryptedData
    const parts = ciphertext.split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid encrypted format");
    }

    const [saltBase64, ivBase64, authTagBase64, encrypted] = parts;

    // Decode from base64
    const salt = Buffer.from(saltBase64, "base64");
    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    // Derive key from password and salt
    const key = await deriveKey(encryptionKey, salt);

    // Create decipher
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    loggers.bot.error("Decryption failed", error);
    throw new Error("Failed to decrypt value - invalid key or corrupted data", {
      cause: error,
    });
  }
}

/**
 * Checks if a string appears to be encrypted (contains colons in the expected format)
 * This is used to determine if data needs to be migrated
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  // Encrypted format: salt:iv:authTag:encryptedData (4 parts separated by colons)
  const parts = value.split(":");
  return parts.length === 4;
}
