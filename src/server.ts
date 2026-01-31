import { type BetterAuthPlugin, generateId } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import type { PreferenceCreateData } from "mercadopago/dist/clients/preference/create/types";
import { z } from "zod";
import { MercadoPagoPreferenceSchema } from "./schemas";
import {
  idempotencyStore,
  rateLimiter,
  sanitizeMetadata,
  ValidationRules,
  validateIdempotencyKey,
  validatePaymentAmount,
  verifyWebhookSignature,
} from "./security";
import type {
  MercadoPagoPaymentNotification,
  MercadoPagoPaymentRecord,
  MercadoPagoPluginOptions,
} from "./types";

export const mercadoPagoPlugin = (options: MercadoPagoPluginOptions) => {
  const client = new MercadoPagoConfig({
    accessToken: options.accessToken,
  });

  return {
    id: "mercadopago",
    schema: {
      // Payment table - one-time payments
      mercadoPagoPayment: {
        fields: {
          id: { type: "string", required: true },
          externalReference: {
            type: "string",
            required: true,
            unique: true,
          },
          userId: {
            type: "string",
            required: true,
          },
          mercadoPagoPaymentId: {
            type: "string",
            required: false,
            unique: true,
          },
          preferenceId: { type: "string", required: true },
          status: { type: "string", required: true }, // pending, approved, authorized, rejected, cancelled, refunded, charged_back
          statusDetail: { type: "string" }, // accredited, pending_contingency, pending_review_manual, cc_rejected_*, etc
          amount: { type: "number", required: true },
          currency: { type: "string", required: true },
          paymentMethodId: { type: "string" }, // visa, master, pix, etc
          paymentTypeId: { type: "string" }, // credit_card, debit_card, ticket, etc
          metadata: { type: "string" }, // JSON stringified
          createdAt: { type: "date", required: true },
          updatedAt: { type: "date", required: true },
        },
      },
    },
    endpoints: {
      // Create payment preference (NORMAL payments only)
      createPayment: createAuthEndpoint(
        "/mercado-pago/create-payment",
        {
          method: "POST",
          requireAuth: false,
          // bopdy es MercadoPagoPreferenceSchema y ademas tiene idempotencyKey
          body: z.object({
            ...MercadoPagoPreferenceSchema.shape,
            idempotencyKey: z.string().optional(),
          }),
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session) {
            throw new APIError("UNAUTHORIZED");
          }

          // Rate limiting: 10 payment creations per minute per user
          const rateLimitKey = `payment:create:${session.user.id}`;
          if (!rateLimiter.check(rateLimitKey, 10, 60 * 1000)) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message:
                "Too many payment creation attempts. Please try again later.",
            });
          }

          const { back_urls, items, metadata, idempotencyKey } = ctx.body;
          const { success, failure, pending } = back_urls || {};

          // Idempotency check
          if (idempotencyKey) {
            if (!validateIdempotencyKey(idempotencyKey)) {
              throw new APIError("BAD_REQUEST", {
                message: "Invalid idempotency key format",
              });
            }

            const cachedResult = idempotencyStore.get(idempotencyKey);
            if (cachedResult) {
              return ctx.json(cachedResult);
            }
          }

          // Validate currency
          if (
            items.some((item) => !ValidationRules.currency(item.currencyId))
          ) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid currency code",
            });
          }

          // Sanitize metadata
          const sanitizedMetadata = metadata ? sanitizeMetadata(metadata) : {};

          const baseUrl = options.baseUrl || ctx.context.baseURL;

          // Calculate total amount
          const totalAmount = items.reduce(
            (sum, item) => sum + item.unitPrice * item.quantity,
            0,
          );

          // Validate total amount
          if (!ValidationRules.amount(totalAmount)) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid payment amount",
            });
          }

          // Create preference (WITHOUT marketplace config)
          const externalReference = generateId();

          const preferenceBody: PreferenceCreateData["body"] = {
            items: items.map((item) => ({
              id: item.id,
              title: item.title,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              currency_id: item.currencyId,
            })),
            back_urls: {
              success: success || `${baseUrl}/payments/one-time?status=success`,
              failure: failure || `${baseUrl}/payments/one-time?status=failure`,
              pending: pending || `${baseUrl}/payments/one-time?status=pending`,
            },
            auto_return: "approved", // 👈 ESTO ES CLAVE
            external_reference: externalReference,
            metadata: {
              ...sanitizedMetadata,
              userId: session.user.id,
            },
            expires: true,
          };

          const preference = await new Preference(client).create({
            body: preferenceBody,
          });

          // Save payment to database
          const payment = await ctx.context.adapter.create({
            model: "mercadoPagoPayment",
            data: {
              externalReference,
              userId: session.user.id,
              preferenceId: preference.id,
              status: "pending",
              amount: totalAmount,
              currency: items[0]?.currencyId || "ARS",
              metadata: JSON.stringify({
                ...sanitizedMetadata,
                preferenceId: preference.id,
              }),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          const result = {
            checkoutUrl: preference.init_point,
            preferenceId: preference.id,
            payment,
          };

          // Store in idempotency cache
          if (idempotencyKey) {
            idempotencyStore.set(idempotencyKey, result);
          }

          return ctx.json(result);
        },
      ),

      // Webhook handler
      webhook: createAuthEndpoint(
        "/mercado-pago/webhook",
        {
          method: "POST",
        },
        async (ctx) => {
          // Rate limiting global
          const webhookRateLimitKey = "webhook:global";
          if (!rateLimiter.check(webhookRateLimitKey, 1000, 60 * 1000)) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Webhook rate limit exceeded",
            });
          }

          let notification: MercadoPagoPaymentNotification;
          try {
            notification = ctx.body;
          } catch {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid JSON payload",
            });
          }

          // Validación mínima
          if (notification.type !== "payment" || !notification.data?.id) {
            return ctx.json({ received: true });
          }

          if (!ctx.request) {
            throw new APIError("BAD_REQUEST", {
              message: "Missing request",
            });
          }

          // Verificación de firma
          if (options.webhookSecret) {
            const xSignature = ctx.request.headers.get("x-signature");
            const xRequestId = ctx.request.headers.get("x-request-id");
            const dataId = notification.data.id.toString();

            const isValid = verifyWebhookSignature({
              xSignature,
              xRequestId,
              dataId,
              secret: options.webhookSecret,
            });

            if (!isValid) {
              throw new APIError("UNAUTHORIZED", {
                message: "Invalid webhook signature",
              });
            }
          }

          // Idempotencia
          const webhookId = `mp:webhook:${notification.type}:${notification.data.id}`;
          if (idempotencyStore.get(webhookId)) {
            return ctx.json({ received: true });
          }
          idempotencyStore.set(webhookId, true, 24 * 60 * 60 * 1000);

          try {
            const paymentId = notification.data.id.toString();

            const mpPayment = await new Payment(client).get({
              id: paymentId,
            });

            const externalRef = mpPayment.external_reference;

            if (!externalRef) {
              ctx.context.logger.warn("Payment without external_reference", {
                paymentId,
              });
              return ctx.json({ received: true });
            }

            const existingPayment: MercadoPagoPaymentRecord | null =
              await ctx.context.adapter.findOne({
                model: "mercadoPagoPayment",
                where: [
                  {
                    field: "externalReference",
                    value: externalRef,
                  },
                ],
              });

            if (!existingPayment) {
              ctx.context.logger.warn(
                "Payment not found by external_reference",
                { paymentId, externalRef },
              );
              return ctx.json({ received: true });
            }

            // 🔒 Validar monto
            if (
              !validatePaymentAmount(
                existingPayment.amount,
                mpPayment.transaction_amount || 0,
              )
            ) {
              throw new APIError("BAD_REQUEST", {
                message: "Payment amount mismatch",
              });
            }

            // 📝 Actualizar estado
            await ctx.context.adapter.update({
              model: "mercadoPagoPayment",
              where: [{ field: "id", value: existingPayment.id }],
              update: {
                mercadoPagoPaymentId: paymentId,
                status: mpPayment.status,
                statusDetail: mpPayment.status_detail || undefined,
                paymentMethodId: mpPayment.payment_method_id || undefined,
                paymentTypeId: mpPayment.payment_type_id || undefined,
                updatedAt: new Date(),
              },
            });

            // 🔔 Callback opcional
            if (options.onPaymentUpdate && mpPayment.status) {
              await options.onPaymentUpdate({
                payment: existingPayment,
                status: mpPayment.status,
                statusDetail: mpPayment.status_detail || "",
                mpPayment,
              });
            }
          } catch (error) {
            ctx.context.logger.error("Error processing MP webhook", {
              error,
              notification,
            });

            // Mercado Pago debe recibir 200 igual
            return ctx.json({ received: true });
          }

          return ctx.json({ received: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
};
