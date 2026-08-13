import { VRCWebSocket, EventType } from "vrc-ts";
import { vrchatApi } from "../../utility/vrchat/index.js";
import { loggers } from "../../utility/logger.js";
import type { VRChatWebSocketData } from "../../utility/vrchat/types.js";
import {
  handleFriendDelete,
  handleFriendUpdate,
} from "./handlers/friend/index.js";
import { handleFriendAdd } from "./handlers/friend/handleFriendAdded.js";
import { handleGroupJoined } from "./handlers/group/handleGroupJoined.js";
import { handleGroupLeft } from "./handlers/group/handleGroupLeft.js";
import { handleGroupMemberUpdated } from "./handlers/group/handleGroupMemberUpdated.js";
import { handleNotification } from "./handlers/notification/notification.js";
import { WebSocketConstants } from "../../config/constants.js";

// WebSocket instance
let ws: VRCWebSocket | null = null;

// Reconnection state
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let autoReconnectEnabled = true;

/**
 * Stop the VRChat WebSocket listener
 */
export function stopVRChatWebSocketListener() {
  // Disable auto-reconnect when manually stopping
  autoReconnectEnabled = false;
  
  // Clear any pending reconnection attempts
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (ws) {
    try {
      // vrc-ts WebSocket may have different cleanup methods
      // Try to close/cleanup if methods exist
      const wsWithMethods = ws as { close?: () => void; disconnect?: () => void };
      if (typeof wsWithMethods.close === "function") {
        wsWithMethods.close();
      } else if (typeof wsWithMethods.disconnect === "function") {
        wsWithMethods.disconnect();
      }
    } catch (error) {
      loggers.vrchat.error("Error disconnecting WebSocket", error);
    }
    ws = null;
  }
  reconnectAttempts = 0;
  loggers.vrchat.info("VRChat WebSocket listener stopped");
}

/**
 * Attempt to reconnect the WebSocket with exponential backoff
 */
function attemptReconnect() {
  // Check if auto-reconnect is disabled
  if (!autoReconnectEnabled) {
    loggers.vrchat.info("Auto-reconnect is disabled");
    return;
  }

  // Check if we've exceeded max attempts
  if (
    WebSocketConstants.MAX_RECONNECT_ATTEMPTS !== Infinity &&
    reconnectAttempts >= WebSocketConstants.MAX_RECONNECT_ATTEMPTS
  ) {
    loggers.vrchat.error(
      `Max reconnection attempts (${WebSocketConstants.MAX_RECONNECT_ATTEMPTS}) reached. Stopping reconnection attempts.`,
    );
    autoReconnectEnabled = false;
    return;
  }

  // Calculate delay with exponential backoff
  const delay = Math.min(
    WebSocketConstants.INITIAL_RECONNECT_DELAY *
      Math.pow(WebSocketConstants.RECONNECT_DELAY_MULTIPLIER, reconnectAttempts),
    WebSocketConstants.MAX_RECONNECT_DELAY,
  );

  reconnectAttempts++;
  loggers.vrchat.info(
    `Attempting to reconnect WebSocket (attempt ${reconnectAttempts}) in ${delay}ms...`,
  );

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    startVRChatWebSocketListener();
  }, delay);
}

/**
 * Start the VRChat WebSocket listener
 */
export function startVRChatWebSocketListener() {
  // Enable auto-reconnect when starting
  autoReconnectEnabled = true;
  
  // Clear any pending reconnection attempts
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Check if already connected
  if (ws) {
    loggers.vrchat.warn("WebSocket already connected");
    return;
  }

  // Check if API is logged in
  if (!vrchatApi.currentUser) {
    loggers.vrchat.error("Not logged in to VRChat. Please log in first.");
    // Try to reconnect later if auto-reconnect is enabled
    if (autoReconnectEnabled) {
      attemptReconnect();
    }
    return;
  }

  try {
    // Create WebSocket instance with vrc-ts
    ws = new VRCWebSocket({
      vrchatAPI: vrchatApi,
      eventsToListenTo: [
        EventType.Friend_Add,
        EventType.Friend_Delete,
        EventType.Friend_Update,
        EventType.Notification,
        EventType.Notification_V2,
        EventType.Group_Join,
        EventType.Group_Leave,
        EventType.Group_Member_Updated,
      ],
    });

    // Friend Events
    ws.on(EventType.Friend_Add, async (data: unknown) => {
      try {
        // vrc-ts provides data in a structured format
        // Map to our handler's expected format
        const typedData = data as VRChatWebSocketData;
        await handleFriendAdd({
          userId: typedData.user?.id || typedData.userId || "",
          user: typedData.user,
        });
      } catch (err) {
        loggers.vrchat.error("Error handling friend-add", err);
      }
    });

    ws.on(EventType.Friend_Delete, async (data: unknown) => {
      try {
        const typedData = data as VRChatWebSocketData;
        await handleFriendDelete({
          userId: typedData.user?.id || typedData.userId || "",
          user: typedData.user,
        });
      } catch (err) {
        loggers.vrchat.error("Error handling friend-delete", err);
      }
    });

    ws.on(EventType.Friend_Update, async (data: unknown) => {
      try {
        const typedData = data as VRChatWebSocketData;
        await handleFriendUpdate({
          userId: typedData.user?.id || typedData.userId || "",
          user: typedData.user,
        });
      } catch (err) {
        loggers.vrchat.error("Error handling friend-update", err);
      }
    });

    // Group events (side effects only - forum audit logs come from audit poller)
    ws.on(EventType.Group_Join, async (data: unknown) => {
      try {
        const typedData = data as VRChatWebSocketData;
        await handleGroupJoined({
          userId: typedData.user?.id || typedData.userId || "",
        });
      } catch (err) {
        loggers.vrchat.error("Error handling group-joined", err);
      }
    });

    ws.on(EventType.Group_Leave, async (data: unknown) => {
      try {
        const typedData = data as VRChatWebSocketData;
        await handleGroupLeft({
          userId: typedData.user?.id || typedData.userId || "",
        });
      } catch (err) {
        loggers.vrchat.error("Error handling group-left", err);
      }
    });

    ws.on(EventType.Group_Member_Updated, async (data: unknown) => {
      try {
        await handleGroupMemberUpdated(data);
      } catch (err) {
        loggers.vrchat.error("Error handling group-member-updated", err);
      }
    });

    // Notification Events
    ws.on(EventType.Notification, async (data: unknown) => {
      try {
        // vrc-ts notification format may differ, adapt as needed
        await handleNotification(data);
      } catch (err) {
        loggers.vrchat.error("Error handling notification", err);
      }
    });

    ws.on(EventType.Notification_V2, async (data: unknown) => {
      try {
        // Handle v2 notifications
        await handleNotification(data);
      } catch (err) {
        loggers.vrchat.error("Error handling notification-v2", err);
      }
    });

    // Error handling
    ws.on(EventType.Error, (error: unknown) => {
      loggers.vrchat.error("VRChat WebSocket error", error);
    });

    // Connection events - vrc-ts WebSocket may use different event names
    // The WebSocket should connect automatically when created
    // Listen for connection events if available
    const wsWithEvents = ws as { on?: (event: string, handler: () => void) => void };
    if (typeof wsWithEvents.on === "function") {
      try {
        wsWithEvents.on("open", () => {
          loggers.vrchat.info("Connected to VRChat WebSocket");
          // Reset reconnect attempts on successful connection
          reconnectAttempts = 0;
        });

        wsWithEvents.on("close", () => {
          loggers.vrchat.warn("VRChat WebSocket disconnected");
          ws = null;
          // Attempt to reconnect if auto-reconnect is enabled
          if (autoReconnectEnabled) {
            attemptReconnect();
          }
        });
      } catch {
        // Event listeners may not be available in this format
        loggers.vrchat.debug("Could not set up connection event listeners");
      }
    }

    loggers.vrchat.info("VRChat WebSocket listener started");
  } catch (error) {
    loggers.vrchat.error("Failed to start VRChat WebSocket listener", error);
    ws = null;
    // Attempt to reconnect on error if auto-reconnect is enabled
    if (autoReconnectEnabled) {
      attemptReconnect();
    }
  }
}