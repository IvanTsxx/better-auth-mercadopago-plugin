import crypto from "node:crypto";
import type { Status } from "better-auth";
import { APIError } from "better-auth/api";

/**
 * Verify Mercado Pago webhook signature
 * https://www.mercadopago.com/developers/en/docs/subscriptions/additional-content/security/signature
 */
export function verifyWebhookSignature(params: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  secret: string;
}): boolean {
  const { xSignature, xRequestId, dataId, secret } = params;

  if (!xSignature || !xRequestId) {
    return false;
  }

  // Parse x-signature header
  // Format: "ts=1234567890,v1=hash"
  const parts = xSignature.split(",");
  const ts = parts.find((p) => p.startsWith("ts="))?.split("=")[1];
  const hash = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

  if (!ts || !hash) {
    return false;
  }

  // Build the manifest (exactly as MP does)
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Create HMAC SHA256
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(manifest);
  const expectedHash = hmac.digest("hex");

  // Compare hashes (constant-time comparison)
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

/**
 * Rate limiting store (in-memory, use Redis in production)
 */
class RateLimiter {
  private attempts: Map<string, { count: number; resetAt: number }> = new Map();

  check(key: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || now > record.resetAt) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    }

    if (record.count >= maxAttempts) {
      return false;
    }

    record.count++;
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.attempts.entries()) {
      if (now > record.resetAt) {
        this.attempts.delete(key);
      }
    }
  }
}

export const rateLimiter = new RateLimiter();

// Cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

/**
 * Validate payment amount to prevent manipulation
 */
export function validatePaymentAmount(
  requestedAmount: number,
  mpPaymentAmount: number,
  tolerance: number = 0.01,
): boolean {
  const diff = Math.abs(requestedAmount - mpPaymentAmount);
  return diff <= tolerance;
}

/**
 * Sanitize metadata to prevent injection attacks
 */
export function sanitizeMetadata(
  // biome-ignore lint/suspicious/noExplicitAny: <necessary>
  metadata: Record<string, any>,
  // biome-ignore lint/suspicious/noExplicitAny: <necessary>
): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: <necessary>
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Prevent prototype pollution
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }

    // Limit metadata size
    if (typeof value === "string" && value.length > 5000) {
      sanitized[key] = value.substring(0, 5000);
    } else if (typeof value === "object" && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validate callback URL to prevent open redirects
 */
export function validateCallbackUrl(
  url: string,
  allowedDomains: string[],
): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTPS in production
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return false;
    }

    // Check if domain is allowed
    const hostname = parsed.hostname;
    return allowedDomains.some((domain) => {
      if (domain.startsWith("*.")) {
        // Wildcard subdomain
        const baseDomain = domain.substring(2);
        return hostname.endsWith(baseDomain);
      }
      return hostname === domain;
    });
  } catch {
    return false;
  }
}

/**
 * Idempotency key validation
 */
export function validateIdempotencyKey(key: string): boolean {
  // UUID v4 format or custom format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const customRegex = /^[a-zA-Z0-9_-]{8,64}$/;

  return uuidRegex.test(key) || customRegex.test(key);
}

/**
 * Prevent timing attacks on webhook validation
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Error codes mapping
 */
export const MercadoPagoErrorCodes = {
  // Authentication
  INVALID_API_KEY: "invalid_api_key",
  UNAUTHORIZED: "unauthorized",

  // Payment errors
  INSUFFICIENT_FUNDS: "cc_rejected_insufficient_amount",
  INVALID_CARD: "cc_rejected_bad_filled_card_number",
  CARD_DISABLED: "cc_rejected_card_disabled",
  MAX_ATTEMPTS: "cc_rejected_max_attempts",
  DUPLICATED_PAYMENT: "cc_rejected_duplicated_payment",

  // Subscription errors
  SUBSCRIPTION_NOT_FOUND: "subscription_not_found",
  SUBSCRIPTION_ALREADY_CANCELLED: "subscription_already_cancelled",

  // General
  INVALID_PARAMETER: "invalid_parameter",
  RESOURCE_NOT_FOUND: "resource_not_found",
  INTERNAL_SERVER_ERROR: "internal_server_error",
} as const;

/**
 * Custom error class for Mercado Pago errors
 */
export class MercadoPagoError extends Error {
  constructor(
    public code: string,
    public override message: string,
    public statusCode: number = 400,
    // biome-ignore lint/suspicious/noExplicitAny: <necessary>
    public details?: any,
  ) {
    super(message);
    this.name = "MercadoPagoError";
  }

  toAPIError(): APIError {
    const errorMap: Record<
      number,
      | "OK"
      | "CREATED"
      | "ACCEPTED"
      | "NO_CONTENT"
      | "MULTIPLE_CHOICES"
      | "MOVED_PERMANENTLY"
      | "FOUND"
      | "SEE_OTHER"
      | "NOT_MODIFIED"
      | "TEMPORARY_REDIRECT"
      | "BAD_REQUEST"
      | "UNAUTHORIZED"
      | "PAYMENT_REQUIRED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "METHOD_NOT_ALLOWED"
      | "NOT_ACCEPTABLE"
      | "PROXY_AUTHENTICATION_REQUIRED"
      | "REQUEST_TIMEOUT"
      | "CONFLICT"
      | "GONE"
      | "LENGTH_REQUIRED"
      | "PRECONDITION_FAILED"
      | "PAYLOAD_TOO_LARGE"
      | "URI_TOO_LONG"
      | "UNSUPPORTED_MEDIA_TYPE"
      | "RANGE_NOT_SATISFIABLE"
      | "EXPECTATION_FAILED"
      | "I'M_A_TEAPOT"
      | "MISDIRECTED_REQUEST"
      | "UNPROCESSABLE_ENTITY"
      | "LOCKED"
      | "FAILED_DEPENDENCY"
      | "TOO_EARLY"
      | "UPGRADE_REQUIRED"
      | "PRECONDITION_REQUIRED"
      | "TOO_MANY_REQUESTS"
      | "REQUEST_HEADER_FIELDS_TOO_LARGE"
      | "UNAVAILABLE_FOR_LEGAL_REASONS"
      | "INTERNAL_SERVER_ERROR"
      | "NOT_IMPLEMENTED"
      | "BAD_GATEWAY"
      | "SERVICE_UNAVAILABLE"
      | "GATEWAY_TIMEOUT"
      | "HTTP_VERSION_NOT_SUPPORTED"
      | "VARIANT_ALSO_NEGOTIATES"
      | "INSUFFICIENT_STORAGE"
      | "LOOP_DETECTED"
      | "NOT_EXTENDED"
      | "NETWORK_AUTHENTICATION_REQUIRED"
      | Status
      | undefined
    > = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      429: "TOO_MANY_REQUESTS",
      500: "INTERNAL_SERVER_ERROR",
    };

    const type = errorMap[this.statusCode] || "BAD_REQUEST";

    return new APIError(type, {
      message: this.message,
      details: this.details,
    });
  }
}

/**
 * Handle Mercado Pago API errors
 */ // biome-ignore lint/suspicious/noExplicitAny: <necessary>
export function handleMercadoPagoError(error: any): never {
  if (error.status) {
    const mpError = new MercadoPagoError(
      error.code || "unknown_error",
      error.message || "An error occurred with Mercado Pago",
      error.status,
      error.cause,
    );
    throw mpError.toAPIError();
  }

  throw new APIError("INTERNAL_SERVER_ERROR", {
    message: "Failed to process Mercado Pago request",
  });
}

/**
 * Webhook event types validation
 */
export const VALID_WEBHOOK_TOPICS = [
  "payment",
  "merchant_order",
  "subscription_preapproval",
  "subscription_preapproval_plan",
  "subscription_authorized_payment",
  "point_integration_wh",
  "topic_claims_integration_wh",
  "topic_merchant_order_wh",
  "delivery_cancellation",
] as const;

export type WebhookTopic = (typeof VALID_WEBHOOK_TOPICS)[number];

export function isValidWebhookTopic(topic: string): topic is WebhookTopic {
  return VALID_WEBHOOK_TOPICS.includes(topic as WebhookTopic);
}

/**
 * Idempotency store (in-memory, use Redis in production)
 */
class IdempotencyStore {
  // biome-ignore lint/suspicious/noExplicitAny: <necessary>
  private store: Map<string, { result: any; expiresAt: number }> = new Map();

  // biome-ignore lint/suspicious/noExplicitAny: <necessary>
  get(key: string): any | null {
    const record = this.store.get(key);
    if (!record || Date.now() > record.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return record.result;
  }

  // biome-ignore lint/suspicious/noExplicitAny: <necessary>
  set(key: string, result: any, ttlMs: number = 24 * 60 * 60 * 1000) {
    this.store.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export const idempotencyStore = new IdempotencyStore();

// Cleanup every hour
setInterval(() => idempotencyStore.cleanup(), 60 * 60 * 1000);

/**
 * CSRF token validation
 */
export function validateCSRFToken(
  token: string,
  expectedToken: string,
): boolean {
  return secureCompare(token, expectedToken);
}

/**
 * Input validation helpers
 */
export const ValidationRules = {
  email: (email: string): boolean => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email) && email.length <= 255;
  },

  amount: (amount: number): boolean => {
    return amount > 0 && amount <= 999999999 && !Number.isNaN(amount);
  },

  currency: (currency: string): boolean => {
    const validCurrencies = [
      "ARS", // Peso argentino
      "BRL", // Real brasileño
      "CLP", // Peso chileno
      "MXN", // Peso mexicano
      "COP", // Peso colombiano
      "PEN", // Sol peruano
      "UYU", // Peso uruguayo
    ];
    return validCurrencies.includes(currency);
  },

  frequency: (frequency: number): boolean => {
    return frequency > 0 && frequency <= 365 && Number.isInteger(frequency);
  },

  userId: (userId: string): boolean => {
    // UUID or custom ID format
    return /^[a-zA-Z0-9_-]{1,100}$/.test(userId);
  },
};
