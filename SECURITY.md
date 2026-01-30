# Security Guide

This document outlines the security measures implemented in the Mercado Pago Better Auth plugin.

## Table of Contents

1. [Webhook Security](#webhook-security)
2. [Rate Limiting](#rate-limiting)
3. [Input Validation](#input-validation)
4. [Idempotency](#idempotency)
5. [Error Handling](#error-handling)
6. [Attack Prevention](#attack-prevention)
7. [Best Practices](#best-practices)

## Webhook Security

### Signature Verification

All webhooks are verified using HMAC SHA256 signatures to ensure they come from Mercado Pago.

**Configuration:**

```typescript
mercadoPago({
  webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET!,
  // ...
})
```

**How it works:**

1. Mercado Pago sends a signature in the `x-signature` header
2. Format: `ts=1234567890,v1=hash`
3. The plugin verifies using: `HMAC-SHA256(secret, "id:DATA_ID;request-id:REQUEST_ID;ts:TIMESTAMP;")`
4. Invalid signatures are rejected with 401

**Get your webhook secret:**
- Go to https://www.mercadopago.com/developers/panel/notifications/webhooks
- Click on your webhook
- Copy the "Secret" value

### Webhook Topics Validation

Only valid webhook topics are processed:

- `payment`
- `merchant_order`
- `subscription_preapproval`
- `subscription_preapproval_plan`
- `subscription_authorized_payment`

Invalid topics are logged and ignored.

### Idempotency Protection

Prevents duplicate webhook processing:

```typescript
// Each webhook is processed only once
const webhookId = `webhook:${notification.id}:${notification.type}`;
```

Webhooks are cached for 24 hours to prevent reprocessing.

## Rate Limiting

### Per-User Limits

```typescript
// Payment creation: 10 per minute per user
const rateLimitKey = `payment:create:${userId}`;
rateLimiter.check(rateLimitKey, 10, 60 * 1000);
```

### Global Limits

```typescript
// Webhooks: 1000 per minute globally
rateLimiter.check("webhook:global", 1000, 60 * 1000);
```

### Production Recommendations

For production, replace the in-memory rate limiter with Redis:

```typescript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

class RedisRateLimiter {
  async check(key: string, max: number, windowMs: number): Promise<boolean> {
    const count = await redis.incr(key);
    
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }
    
    return count <= max;
  }
}
```

## Input Validation

### Amount Validation

```typescript
// Prevents negative or excessive amounts
ValidationRules.amount(amount); // 0 < amount <= 999,999,999
```

### Currency Validation

```typescript
// Only accepts valid currencies
ValidationRules.currency("ARS"); // true
ValidationRules.currency("INVALID"); // false

// Supported: ARS, BRL, CLP, MXN, COP, PEN, UYU, USD
```

### URL Validation

Prevents open redirect vulnerabilities:

```typescript
validateCallbackUrl(
  "https://myapp.com/callback",
  ["myapp.com", "*.myapp.com"]
); // true

validateCallbackUrl(
  "https://evil.com/phishing",
  ["myapp.com"]
); // false
```

**Configuration:**

```typescript
mercadoPago({
  trustedOrigins: [
    "https://myapp.com",
    "https://*.myapp.com", // Wildcard subdomains
  ],
})
```

### Metadata Sanitization

Prevents prototype pollution and XSS:

```typescript
const sanitized = sanitizeMetadata({
  orderId: "123",
  __proto__: { isAdmin: true }, // ❌ Removed
  userInput: "<script>alert('xss')</script>", // Kept but limited to 5000 chars
});
```

## Idempotency

### Payment Creation

```typescript
const { data } = await authClient.mercadoPago.createPayment({
  items: [/* ... */],
  idempotencyKey: "unique-key-123", // Same key = same result
});
```

**Rules:**

- Key format: UUID v4 or alphanumeric (8-64 chars)
- Cached for 24 hours
- Same key = returns cached response (no duplicate payments)

**Example:**

```typescript
// First request
const result1 = await createPayment({
  idempotencyKey: "abc-123",
  items: [{ title: "Product", quantity: 1, unitPrice: 100 }]
});
// Creates new payment

// Second request (network retry, user double-click, etc.)
const result2 = await createPayment({
  idempotencyKey: "abc-123",
  items: [{ title: "Product", quantity: 1, unitPrice: 100 }]
});
// Returns cached result, no duplicate payment ✅
```

## Error Handling

### Graceful Degradation

```typescript
try {
  await mpAPI.createPayment();
} catch (error) {
  handleMercadoPagoError(error);
  // Converts MP errors to Better Auth APIError format
}
```

### Error Types

| Status | Better Auth Type | Use Case |
|--------|-----------------|----------|
| 400 | BAD_REQUEST | Invalid input |
| 401 | UNAUTHORIZED | Invalid credentials |
| 403 | FORBIDDEN | Not allowed |
| 404 | NOT_FOUND | Resource missing |
| 429 | TOO_MANY_REQUESTS | Rate limited |
| 500 | INTERNAL_SERVER_ERROR | Server error |

### Webhook Error Handling

Webhooks return 200 even on processing errors to prevent infinite retries:

```typescript
try {
  await processWebhook(notification);
} catch (error) {
  logger.error("Webhook processing failed", { error });
  // Still return 200 to acknowledge receipt
}

return ctx.json({ received: true });
```

## Attack Prevention

### SQL Injection

✅ **Protected** - Uses parameterized queries via Better Auth adapter:

```typescript
// ✅ Safe
await ctx.context.adapter.findOne({
  model: "mercadoPagoPayment",
  where: [{ field: "id", value: userInput }] // Parameterized
});

// ❌ Never do this
await db.raw(`SELECT * FROM payments WHERE id = '${userInput}'`);
```

### XSS (Cross-Site Scripting)

✅ **Protected** - Metadata is sanitized and limited to 5000 chars:

```typescript
const sanitized = sanitizeMetadata(userInput);
// Scripts, iframes, etc. are stored but limited
// Rendering layer must still escape HTML
```

### CSRF (Cross-Site Request Forgery)

✅ **Protected** - Better Auth handles CSRF tokens automatically:

```typescript
// Better Auth adds CSRF protection to all POST endpoints
// No additional configuration needed
```

### Prototype Pollution

✅ **Protected** - Dangerous keys are filtered:

```typescript
sanitizeMetadata({
  __proto__: { isAdmin: true }, // ❌ Removed
  constructor: { ... }, // ❌ Removed
  prototype: { ... }, // ❌ Removed
  normalKey: "value", // ✅ Kept
});
```

### Timing Attacks

✅ **Protected** - Uses constant-time comparison for signatures:

```typescript
// ❌ Vulnerable
if (signature === expectedSignature) { }

// ✅ Safe
if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) { }
```

### Payment Amount Manipulation

✅ **Protected** - Validates amounts haven't been tampered:

```typescript
// In webhook
if (!validatePaymentAmount(storedAmount, mpPayment.amount)) {
  throw new Error("Amount mismatch - possible tampering");
}
```

### Replay Attacks

✅ **Protected** - Webhooks are deduplicated:

```typescript
const webhookId = `webhook:${id}:${type}`;
if (alreadyProcessed(webhookId)) {
  return; // Ignore duplicate
}
```

## Best Practices

### 1. Always Use HTTPS in Production

```typescript
// In production, validate URLs are HTTPS
if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
  throw new Error("URLs must use HTTPS in production");
}
```

### 2. Set Strict Trusted Origins

```typescript
mercadoPago({
  trustedOrigins: [
    "https://myapp.com", // ✅ Specific domain
    "https://*.myapp.com", // ✅ Wildcard subdomains
    // ❌ Don't use wildcards like "*" or "*.com"
  ],
})
```

### 3. Use Environment Variables

```env
# ✅ Good
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-xxx
MERCADO_PAGO_WEBHOOK_SECRET=xxx
APP_URL=https://myapp.com

# ❌ Bad - never hardcode secrets
const accessToken = "APP_USR-123456...";
```

### 4. Monitor Webhook Failures

```typescript
mercadoPago({
  onPaymentUpdate: async ({ payment, status }) => {
    if (status === "rejected") {
      // Alert your team
      await alerting.notify("Payment rejected", { payment });
    }
  },
})
```

### 5. Implement Proper Logging

```typescript
// Log security events
logger.warn("Invalid webhook signature", {
  xSignature,
  xRequestId,
  ip: request.ip,
});

// Don't log sensitive data
// ❌ logger.info("Payment", { cardNumber: "..." });
// ✅ logger.info("Payment", { paymentId: "..." });
```

### 6. Use Redis for Production

Replace in-memory stores with Redis:

- Rate limiting
- Idempotency cache
- Webhook deduplication

### 7. Regular Security Audits

- Review logs for suspicious patterns
- Update dependencies regularly
- Test webhook signature validation
- Validate rate limits are working

### 8. Implement Monitoring

```typescript
// Track failed webhooks
if (webhookProcessingFailed) {
  metrics.increment("webhook.failed", {
    type: notification.type,
    error: error.message,
  });
}
```

### 9. Handle PCI Compliance

⚠️ **Never store card data:**

```typescript
// ❌ Never do this
const cardData = {
  number: "4111111111111111",
  cvv: "123",
  expiry: "12/25"
};

// ✅ Let Mercado Pago handle it
// Users enter card details directly in MP's hosted checkout
```

### 10. Database Security

```typescript
// Use row-level security
CREATE POLICY user_payments ON mercadoPagoPayment
  FOR SELECT
  USING (userId = current_user_id());

// Encrypt sensitive fields
encryptedMetadata = encrypt(metadata, encryptionKey);
```

## Security Checklist

Before deploying to production:

- [ ] Webhook secret configured
- [ ] HTTPS enforced
- [ ] Trusted origins set
- [ ] Rate limiting configured (Redis recommended)
- [ ] Error logging implemented
- [ ] Monitoring and alerts set up
- [ ] Never log sensitive data (cards, tokens)
- [ ] Database has proper indexes
- [ ] Row-level security enabled (if using Postgres)
- [ ] Regular dependency updates scheduled
- [ ] Incident response plan documented

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. Email security@yourcompany.com
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We'll respond within 48 hours.

## License

MIT
