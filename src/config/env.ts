import { z } from "zod";

/**
 * Environment variable schema with validation
 * Validates all environment variables at startup and provides type-safe access
 */
const envSchema = z.object({
  // Discord Configuration (Required)
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  APPLICATION_ID: z.string().min(1, "APPLICATION_ID is required").optional(),
  BOT_OWNER_ID: z.string().min(1, "BOT_OWNER_ID is required"),

  // Database Configuration (Required)
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid database URL"),

  // API Configuration (Optional)
  PORT: z
    .string()
    .regex(/^\d+$/, "PORT must be a number")
    .default("3000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(65535)),

  PUBLIC_API_BASE_URL: z
    .string()
    .url("PUBLIC_API_BASE_URL must be a valid URL")
    .default("https://api.vrcshield.com"),

  ENV: z.enum(["development", "production", "test"]).default("development"),

  // Logging Configuration (Optional)
  LOG_LEVEL: z
    .enum(["DEBUG", "INFO", "WARN", "ERROR"])
    .default("INFO")
    .transform((val) => val.toUpperCase()),

  // VRChat Configuration (Optional - bot can run without VRChat)
  VRCHAT_USERNAME: z.string().optional(),
  VRCHAT_PASSWORD: z.string().optional(),
  VRCHAT_OTP_TOKEN: z.string().optional(),
  VRCHAT_RECOVERY: z.string().optional(),
  VRCHAT_USER_AGENT: z.string().optional(),

  // Whitelist Configuration (Optional)
  WHITELIST_XOR_KEY: z.string().optional(),

  // Encryption Configuration (Required for encrypted database fields)
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters").optional(),

  // Cloudflare Configuration (Optional)
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),

  // GitHub Configuration (Optional - for whitelist backup)
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO_OWNER: z.string().optional(),
  GITHUB_REPO_NAME: z.string().optional(),
  GITHUB_REPO_BRANCH: z.string().default("main"),
  GITHUB_REPO_ENCODED_FILE_PATH: z.string().default("whitelist.encoded.txt"),
  GITHUB_REPO_DECODED_FILE_PATH: z.string().default("whitelist.txt"),

  // Git Signing Configuration (Optional)
  GIT_SIGN_COMMITS: z
    .string()
    .default("false")
    .transform((val) => val.toLowerCase() === "true")
    .pipe(z.boolean()),
  GIT_AUTHOR_NAME: z.string().optional(),
  GIT_AUTHOR_EMAIL: z.string().optional(),
  GIT_COMMITTER_NAME: z.string().optional(),
  GIT_COMMITTER_EMAIL: z.string().optional(),
  GIT_PGP_PRIVATE_KEY: z.string().optional(),
  GIT_PGP_PASSPHRASE: z.string().optional(),
});

/**
 * Validated and typed environment variables
 * This object is populated at startup after validation
 */
export type Env = z.infer<typeof envSchema>;

let env: Env;

/**
 * Validates and loads environment variables
 * Should be called at application startup before using any env vars
 * @throws {Error} If required environment variables are missing or invalid
 */
export function validateEnv(): Env {
  try {
    env = envSchema.parse(process.env);
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues
        .filter((e: z.ZodIssue) => {
          if (e.code === "invalid_type") {
            const invalidTypeIssue = e as z.ZodIssue & { received?: string };
            return invalidTypeIssue.received === "undefined";
          }
          return false;
        })
        .map((e: z.ZodIssue) => e.path.join("."));
      const invalidVars = error.issues
        .filter((e: z.ZodIssue) => {
          if (e.code === "invalid_type") {
            const invalidTypeIssue = e as z.ZodIssue & { received?: string };
            return invalidTypeIssue.received !== "undefined";
          }
          return true;
        })
        .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`);

      let errorMessage = "Environment variable validation failed:\n\n";

      if (missingVars.length > 0) {
        errorMessage += `Missing required variables:\n${missingVars.map((v: string) => `  - ${v}`).join("\n")}\n\n`;
      }

      if (invalidVars.length > 0) {
        errorMessage += `Invalid variables:\n${invalidVars.map((v: string) => `  - ${v}`).join("\n")}\n`;
      }

      throw new Error(errorMessage, { cause: error });
    }
    throw error;
  }
}

/**
 * Get validated environment variables
 * @throws {Error} If validateEnv() hasn't been called yet
 */
export function getEnv(): Env {
  if (!env) {
    throw new Error(
      "Environment variables not validated. Call validateEnv() at startup first.",
    );
  }
  return env;
}

/**
 * Check if VRChat credentials are configured
 */
export function hasVRChatCredentials(): boolean {
  const env = getEnv();
  return !!(env.VRCHAT_USERNAME && env.VRCHAT_PASSWORD);
}

