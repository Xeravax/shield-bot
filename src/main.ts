import "dotenv/config";
import { dirname, importx } from "@discordx/importer";
import { Koa } from "@discordx/koa";
import multer from "@koa/multer";
import {
  Interaction,
  Message,
  MessageFlags,
} from "discord.js";
import { Client } from "discordx";
import bodyParser from "@koa/bodyparser";
import { PrismaClient } from "./generated/prisma/client.js";
import { PatrolTimerManager } from "./managers/patrol/patrolTimerManager.js";
import { LOAManager } from "./managers/loa/loaManager.js";
import { RoleTrackingManager } from "./managers/roleTracking/roleTrackingManager.js";
import {
  isLoggedInAndVerified,
  loginAndGetCurrentUser,
} from "./utility/vrchat.js";
import { startVRChatWebSocketListener, stopVRChatWebSocketListener } from "./events/vrchat/vrchat-websocket.js";
// Invite message functionality removed - not in use
// import {
//   syncAllInviteMessages,
//   syncInviteMessageIfDifferent,
// } from "./managers/messages/InviteMessageManager.js";
import { initializeSchedules } from "./schedules/schedules.js";
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { whitelistManager } from "./managers/whitelist/whitelistManager.js";
import { validateEnv, getEnv, hasVRChatCredentials } from "./config/env.js";
import { loggers, logger, LogLevel } from "./utility/logger.js";
import { ConfigError } from "./utility/errors.js";
import { ExceptionConstants } from "./config/constants.js";
import { BOT_INTENTS, BOT_CONFIG } from "./config/discord.js";

// Validate environment variables at startup
let env;
try {
  env = validateEnv();
  
  // Set log level from environment variable
  const logLevelMap: Record<string, LogLevel> = {
    DEBUG: LogLevel.DEBUG,
    INFO: LogLevel.INFO,
    WARN: LogLevel.WARN,
    ERROR: LogLevel.ERROR,
  };
  const logLevel = logLevelMap[env.LOG_LEVEL] ?? LogLevel.INFO;
  logger.setLevel(logLevel);
} catch (error) {
  loggers.startup.error("Failed to validate environment variables", error);
  process.exit(1);
}

const databaseUrl = env.DATABASE_URL;
const adapter = new PrismaMariaDb(databaseUrl);
export const prisma = new PrismaClient({ adapter });

// Get environment to check if we're in development
const envForBot = validateEnv();
const isDevelopmentForBot = envForBot.ENV === "development";
const devGuildIdForBot = "1241178553111019522";

export const bot = new Client({
  intents: BOT_INTENTS,
  silent: BOT_CONFIG.silent,
  botGuilds: isDevelopmentForBot ? [devGuildIdForBot] : undefined,
});

// Global patrol timer manager singleton
export const patrolTimer = new PatrolTimerManager(bot);

// Global LOA manager singleton
export const loaManager = new LOAManager(bot);

// Global role tracking manager singleton
export const roleTrackingManager = new RoleTrackingManager(bot, patrolTimer);

bot.rest.on("rateLimited", (info) => {
  loggers.bot.warn("Rate limit hit!", {
    endpoint: info.route,
    timeout: info.timeToReset,
    limit: info.limit,
  });
});

bot.once("clientReady", async () => {
  try {

    if (isDevelopmentForBot) {
      // In development: register commands to specific guild and delete global commands
      loggers.bot.info("Development mode detected - registering commands to guild and clearing global commands");
            
      // Register commands to the development guild
      // botGuilds is set in Client constructor, so initApplicationCommands will register to guild
      await bot.initApplicationCommands();
      
      loggers.bot.info(`Commands registered to development guild: ${devGuildIdForBot}`);
    } else {
      // In production: register commands globally
      await bot.initApplicationCommands();
    }

    const mode = isDevelopmentForBot ? "DEVELOPMENT" : "PROD";
    const logLevel = process.env.LOG_LEVEL?.toUpperCase() || "INFO";
    const left = `Mode: ${mode}`, right = `Log: ${logLevel}`;
    const modeLogLine = `|${" ".repeat(Math.floor((24 - left.length - 2) / 2))}${left}${" ".repeat(Math.ceil((24 - left.length - 2) / 2))}|${" ".repeat(Math.floor((27 - right.length - 1) / 2))}${right}${" ".repeat(Math.ceil((27 - right.length - 1) / 2))}|`;
    
    loggers.bot.info("###################################################");
    loggers.bot.info(modeLogLine);
    loggers.bot.info("|                      |     S.H.I.E.L.D. Bot     |");
    loggers.bot.info("|                      |                          |");
    loggers.bot.info("|                      | stefano@stefanocoding.me |");
    loggers.bot.info("|                      |         Xeravax          |");
    loggers.bot.info("|                      |                          |");
    loggers.bot.info("###################################################");

    // VRChat login on startup
    if (!hasVRChatCredentials()) {
      loggers.vrchat.warn(
        "VRChat credentials not set in environment variables. Skipping VRChat login.",
      );
    } else {
      try {
        const env = getEnv();
        if (!env.VRCHAT_USERNAME || !env.VRCHAT_PASSWORD) {
          throw new Error("VRChat credentials are required but not set");
        }
        const user = await loginAndGetCurrentUser(
          env.VRCHAT_USERNAME,
          env.VRCHAT_PASSWORD,
        );
        const userTyped = user as { displayName?: string; username?: string; id: string };
        loggers.vrchat.info(
          `VRChat login successful: ${userTyped.displayName || ""} | ${userTyped.username || ""} | ${userTyped.id}`,
        );
      } catch (err) {
        loggers.vrchat.error("VRChat login failed", err);
      }
    }
  } catch (error) {
    loggers.bot.error("Failed to initialize application commands", error);
  }

  loggers.schedules.info("Initializing schedules...");
  initializeSchedules(bot);
  loggers.schedules.info("Schedules initialized.");

  // Initialize Patrol Timer after bot is ready
  loggers.patrol.info("Initializing patrol timer...");
  await patrolTimer.init();
  loggers.patrol.info("Patrol timer initialized.");

  const vrchatIsRunning = await isLoggedInAndVerified();
  if (vrchatIsRunning) {
    loggers.vrchat.info("VRChat is running");
    startVRChatWebSocketListener();
    // Invite message sync removed - not in use
    // syncAllInviteMessages().catch((err) => {
    //   loggers.vrchat.error("Failed to sync invite messages", err);
    // });
  } else {
    loggers.vrchat.info("VRChat is not running");
  }
});

bot.on("interactionCreate", async (interaction: Interaction) => {
  try {
    await bot.executeInteraction(interaction);
  } catch (error) {
    loggers.bot.error("Error handling interaction", error, {
      interactionId: interaction.id,
      type: interaction.type,
    });
    // Try to respond if interaction hasn't been responded to
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "❌ An error occurred while processing your request.",
          flags: MessageFlags.Ephemeral,
        });
      } catch (replyError) {
        // Ignore errors from trying to reply (might be too late)
        loggers.bot.error("Failed to send error reply", replyError);
      }
    }
  }
});

bot.on("messageCreate", async (message: Message) => {
  try {
    await bot.executeCommand(message);
  } catch (error) {
    loggers.bot.error("Error handling message", error, {
      messageId: message.id,
      channelId: message.channelId,
    });
  }
});

async function run() {
  await importx(
    `${dirname(import.meta.url)}/{events,commands,api}/**/*.{ts,js}`,
  );

  const env = getEnv();
  if (!env.BOT_TOKEN) {
    throw new ConfigError(
      "Bot token missing. Please check you have included it in the .env file. Required field: BOT_TOKEN=xxx",
    );
  }

  await bot.login(env.BOT_TOKEN);

  const server = new Koa();
  server.use(multer().single("file"));
  server.use(bodyParser());
  await server.build();

  const port = env.PORT;
  server.listen(port, () => {
    loggers.bot.info(`Running On Port: ${port}`);
  });
}

// Graceful shutdown handler
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  loggers.shutdown.info(`Received ${signal}, shutting down gracefully...`);

  try {
    // Stop WebSocket listener
    stopVRChatWebSocketListener();
    loggers.shutdown.info("WebSocket listener stopped");

    // Cleanup managers
    whitelistManager.cleanup();
    loggers.shutdown.info("Managers cleaned up");

    // Disconnect bot
    if (bot.isReady()) {
      bot.destroy();
      loggers.shutdown.info("Discord bot disconnected");
    }

    // Close database connection
    await prisma.$disconnect();
    loggers.shutdown.info("Database connection closed");

    loggers.shutdown.info("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    loggers.shutdown.error("Error during shutdown", error);
    process.exit(1);
  }
}

// Track uncaught exceptions to prevent infinite loops
let uncaughtExceptionCount = 0;
let lastUncaughtExceptionTime = 0;

process.on("unhandledRejection", (reason, promise) => {
  logger.error(
    "Unhandled Rejection",
    "Unhandled promise rejection",
    reason instanceof Error ? reason : new Error(String(reason)),
    { promise: String(promise) },
  );
  // Log but don't crash - let the bot continue running
});

process.on("uncaughtException", (error) => {
  const now = Date.now();

  // Reset counter if enough time has passed
  if (now - lastUncaughtExceptionTime > ExceptionConstants.EXCEPTION_RESET_TIME) {
    uncaughtExceptionCount = 0;
  }

  uncaughtExceptionCount++;
  lastUncaughtExceptionTime = now;

  logger.error(
    "Uncaught Exception",
    `Uncaught exception #${uncaughtExceptionCount}`,
    error,
  );

  // Only shutdown if we're getting too many exceptions in a short time (likely infinite loop)
  if (uncaughtExceptionCount >= ExceptionConstants.MAX_UNCAUGHT_EXCEPTIONS) {
    logger.error(
      "Fatal",
      `Too many uncaught exceptions (${uncaughtExceptionCount}) in a short period. Shutting down to prevent infinite loop.`,
    );
    gracefulShutdown("uncaughtException").catch(() => {
      process.exit(1);
    });
  } else {
    logger.warn(
      "Warning",
      "Bot will continue running despite uncaught exception. This may lead to unstable behavior.",
    );
    // Bot continues running - don't exit
  }
});

// Handle termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

run().catch((error) => {
  loggers.startup.error("Fatal error during startup", error);
  process.exit(1);
});
