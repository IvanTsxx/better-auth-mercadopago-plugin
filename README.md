# Mercado Pago Plugin for Better Auth

![CI Status](https://github.com/IvanTsxx/better-auth-mercadopago-plugin/actions/workflows/ci.yml/badge.svg)
![NPM Version](https://img.shields.io/npm/v/better-auth-mercadopago)
![License](https://img.shields.io/npm/l/better-auth-mercadopago)


A robust and type-safe Mercado Pago plugin for [Better Auth](https://better-auth.com). seamless integration for one-time payments, subscriptions, and webhook handling.

## Features

- 💳 **One-time Payments**: Easy API to create payments.
- 🔄 **Subscriptions**: Full support for recurring payments (PreApproval).
- 🔗 **Automatic Linking**: Robustly links recurring payments to subscriptions using `external_reference`.
- 🪝 **Webhook Handling**: Built-in, secure webhook processing for payment updates.
- 🛡️ **Type Safe**: Fully typed requests and responses for a great developer experience.
- 👥 **Customer Management**: Automatically manages Mercado Pago customers for your users.

## Installation

```bash
pnpm add better-auth-mercadopago
# or
npm install better-auth-mercadopago
# or
yarn add better-auth-mercadopago
```

## Quick Start

### 1. Configure the Plugin

Add the plugin to your Better Auth configuration. You need your Mercado Pago Access Token.

```typescript
import { betterAuth } from "better-auth";
import { mercadoPagoPlugin } from "better-auth-mercadopago";

export const auth = betterAuth({
    // ... other config
    plugins: [
        mercadoPagoPlugin({
            accessToken: process.env.MP_ACCESS_TOKEN!,
            onSubscriptionUpdate: async ({ subscription, status, reason, mpPreapproval }) => {
                // Handle subscription status changes (e.g., update DB)
                console.log(`Subscription ${subscription.id} is now ${status}`);
            },
            onPaymentUpdate: async ({ payment, status, mpPayment }) => {
                // Handle one-time payment updates
            }
        })
    ]
});
```

### 2. Client-Side Usage

The plugin exposes client-side methods to create payments and subscriptions.

```typescript
import { createAuthClient } from "better-auth/client";
import { mercadoPagoClient } from "better-auth-mercadopago/client";

const authClient = createAuthClient({
    plugins: [mercadoPagoClient()]
});

// Create a Subscription
async function subscribe() {
    const { data, error } = await authClient.mercadoPago.createSubscription({
        reason: "Pro Plan",
        autoRecurring: {
            frequency: 1,
            frequencyType: "months",
            transactionAmount: 10,
            currencyId: "ARS"
        },
        backUrl: "https://your-app.com/success"
    });

    if (data) {
        window.location.href = data.init_point; // Redirect to Mercado Pago
    }
}
```

## Usage Guide

### Subscriptions

To create a subscription, you use `createSubscription`. The plugin handles the complexity of:
1. Creating a PreApproval Plan.
2. Creating a PreApproval (Subscription) linked to that plan.
3. Returning the `init_point` for user redirection.

### Webhooks

The plugin automatically exposes a webhook endpoint at `/api/auth/mercado-pago/webhook`. 
You must configure this URL in your Mercado Pago Dashboard (or use ngrok for local dev).

**Events Handled:**
- `subscription_authorized_payment`: recurring payments.
- `payment`: one-time payments.
- `preapproval`: subscription status updates.

## API Reference

### `mercadoPagoPlugin(options)`

**Options:**
- `accessToken` (required): Your Mercado Pago Production or Sandbox Access Token.
- `onSubscriptionUpdate`: Callback when a subscription changes status.
- `onPaymentUpdate`: Callback when a payment changes status.
- `onSubscriptionPayment`: Callback when a recurring payment is received.

## Contributing

Contributions are welcome!

1. Clone the repo
2. Install dependencies: `pnpm install`
3. Run tests: `pnpm test`
4. Create a changeset for your changes: `pnpm changeset`

## License

MIT