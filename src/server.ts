import { type BetterAuthPlugin, generateId } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import {
	Customer,
	MercadoPagoConfig,
	Payment,
	PreApproval,
	PreApprovalPlan,
	Preference,
} from "mercadopago";

import type { PreApprovalCreateData } from "mercadopago/dist/clients/preApproval/create/types";
import type { PreApprovalPlanCreateData } from "mercadopago/dist/clients/preApprovalPlan/create/types";
import type { PreferenceCreateData } from "mercadopago/dist/clients/preference/create/types";
import { z } from "zod";
import {
	handleMercadoPagoError,
	idempotencyStore,
	isValidWebhookTopic,
	rateLimiter,
	sanitizeMetadata,
	ValidationRules,
	validateCallbackUrl,
	validateIdempotencyKey,
	validatePaymentAmount,
	verifyWebhookSignature,
} from "./security";
import type {
	MercadoPagoCustomerRecord,
	MercadoPagoPaymentRecord,
	MercadoPagoPaymentResponse,
	MercadoPagoPluginOptions,
	MercadoPagoPreApprovalResponse,
	MercadoPagoSubscriptionRecord,
} from "./types";

export const mercadoPagoPlugin = (options: MercadoPagoPluginOptions) => {
	const client = new MercadoPagoConfig({
		accessToken: options.accessToken,
	});

	const preferenceClient = new Preference(client);
	const paymentClient = new Payment(client);
	const customerClient = new Customer(client);

	const preApprovalClient = new PreApproval(client);
	const preApprovalPlanClient = new PreApprovalPlan(client);

	return {
		id: "mercadopago",

		schema: {
			// Customer table - stores MP customer info
			mercadoPagoCustomer: {
				fields: {
					id: { type: "string", required: true },
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id", onDelete: "cascade" },
					},
					mercadoPagoId: { type: "string", required: true, unique: true },
					email: { type: "string", required: true },
					createdAt: { type: "date", required: true },
					updatedAt: { type: "date", required: true },
				},
			},

			// Payment table - one-time payments
			mercadoPagoPayment: {
				fields: {
					id: { type: "string", required: true },
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id", onDelete: "cascade" },
					},
					mercadoPagoPaymentId: {
						type: "string",
						required: true,
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

			// Subscription table
			mercadoPagoSubscription: {
				fields: {
					id: { type: "string", required: true },
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id", onDelete: "cascade" },
					},
					mercadoPagoSubscriptionId: {
						type: "string",
						required: true,
						unique: true,
					},
					planId: { type: "string", required: true },
					status: { type: "string", required: true }, // authorized, paused, cancelled, pending
					reason: { type: "string" }, // Reason for status (e.g., payment_failed, user_cancelled)
					nextPaymentDate: { type: "date" },
					lastPaymentDate: { type: "date" },
					summarized: { type: "string" }, // JSON with charges, charged_amount, pending_charge_amount
					metadata: { type: "string" }, // JSON stringified
					createdAt: { type: "date", required: true },
					updatedAt: { type: "date", required: true },
				},
			},

			// Preapproval Plan table (reusable subscription plans)
			mercadoPagoPreapprovalPlan: {
				fields: {
					id: { type: "string", required: true },
					mercadoPagoPlanId: { type: "string", required: true, unique: true },
					reason: { type: "string", required: true }, // Plan description
					frequency: { type: "number", required: true },
					frequencyType: { type: "string", required: true }, // days, months
					transactionAmount: { type: "number", required: true },
					currencyId: { type: "string", required: true },
					repetitions: { type: "number" }, // null = infinite
					freeTrial: { type: "string" }, // JSON with frequency and frequency_type
					metadata: { type: "string" }, // JSON stringified
					createdAt: { type: "date", required: true },
					updatedAt: { type: "date", required: true },
				},
			},

			// Split payments table (for marketplace)
			mercadoPagoMarketplaceSplit: {
				fields: {
					id: { type: "string", required: true },
					paymentId: {
						type: "string",
						required: true,
						references: {
							model: "mercadoPagoPayment",
							field: "id",
							onDelete: "cascade",
						},
					},
					// Changed naming to be more clear
					collectorId: { type: "string", required: true }, // MP User ID who receives the money (seller)
					collectorEmail: { type: "string", required: true }, // Email of who receives money
					applicationFeeAmount: { type: "number" }, // Platform commission in absolute value
					applicationFeePercentage: { type: "number" }, // Platform commission percentage
					netAmount: { type: "number", required: true }, // Amount that goes to collector (seller)
					metadata: { type: "string" },
					createdAt: { type: "date", required: true },
				},
			},

			// OAuth tokens for marketplace (to make payments on behalf of sellers)
			mercadoPagoOAuthToken: {
				fields: {
					id: { type: "string", required: true },
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id", onDelete: "cascade" },
					},
					accessToken: { type: "string", required: true },
					refreshToken: { type: "string", required: true },
					publicKey: { type: "string", required: true },
					mercadoPagoUserId: { type: "string", required: true, unique: true },
					expiresAt: { type: "date", required: true },
					createdAt: { type: "date", required: true },
					updatedAt: { type: "date", required: true },
				},
			},
		},
		endpoints: {
			// Get or create customer automatically
			getOrCreateCustomer: createAuthEndpoint(
				"/mercado-pago/customer",
				{
					method: "POST",
					requireAuth: true,
					body: z.object({
						email: z.string().email().optional(),
						firstName: z.string().optional(),
						lastName: z.string().optional(),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
					if (!session) {
						throw new APIError("UNAUTHORIZED", {
							message: "You must be logged in",
						});
					}

					const { email, firstName, lastName } = ctx.body;
					const userEmail = email || session.user.email;

					// Check if customer already exists
					const existingCustomer = await ctx.context.adapter.findOne({
						model: "mercadoPagoCustomer",
						where: [{ field: "userId", value: session.user.id }],
					});

					if (existingCustomer) {
						return ctx.json({ customer: existingCustomer });
					}

					// Create customer in Mercado Pago
					const mpCustomer = await customerClient.create({
						body: {
							email: userEmail,
							first_name: firstName,
							last_name: lastName,
						},
					});

					// Save to database
					const customer = await ctx.context.adapter.create({
						model: "mercadoPagoCustomer",
						data: {
							id: generateId(),
							userId: session.user.id,
							mercadoPagoId: mpCustomer.id,
							email: userEmail,
							createdAt: new Date(),
							updatedAt: new Date(),
						},
					});

					return ctx.json({ customer });
				},
			),

			// OAuth: Get authorization URL for marketplace sellers
			getOAuthUrl: createAuthEndpoint(
				"/mercado-pago/oauth/authorize",
				{
					method: "GET",
					requireAuth: true,
					query: z.object({
						redirectUri: z.string().url(),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					if (!options.appId) {
						throw new APIError("BAD_REQUEST", {
							message:
								"OAuth not configured. Please provide appId in plugin options",
						});
					}

					const { redirectUri } = ctx.query;

					// Validate redirect URI is trusted
					if (!ctx.context.isTrustedOrigin(redirectUri)) {
						throw new APIError("FORBIDDEN", {
							message: "Redirect URI not in trusted origins",
						});
					}

					const authUrl = `https://auth.mercadopago.com/authorization?client_id=${options.appId}&response_type=code&platform_id=mp&state=${session.user.id}&redirect_uri=${encodeURIComponent(redirectUri)}`;

					return ctx.json({ authUrl });
				},
			),

			// OAuth: Exchange code for access token
			exchangeOAuthCode: createAuthEndpoint(
				"/mercado-pago/oauth/callback",
				{
					method: "POST",
					requireAuth: true,
					body: z.object({
						code: z.string(),
						redirectUri: z.string().url(),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					if (!options.appId || !options.appSecret) {
						throw new APIError("BAD_REQUEST", {
							message: "OAuth not configured",
						});
					}

					const { code, redirectUri } = ctx.body;

					// Exchange code for token
					const tokenResponse = await fetch(
						"https://api.mercadopago.com/oauth/token",
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								client_id: options.appId,
								client_secret: options.appSecret,
								grant_type: "authorization_code",
								code,
								redirect_uri: redirectUri,
							}),
						},
					);

					if (!tokenResponse.ok) {
						throw new APIError("BAD_REQUEST", {
							message: "Failed to exchange OAuth code",
						});
					}

					const tokenData = (await tokenResponse.json()) as {
						access_token: string;
						refresh_token: string;
						public_key: string;
						user_id: number;
						expires_in: number;
					};

					// Save OAuth token
					const oauthToken = await ctx.context.adapter.create({
						model: "mercadoPagoOAuthToken",
						data: {
							id: generateId(),
							userId: session.user.id,
							accessToken: tokenData.access_token,
							refreshToken: tokenData.refresh_token,
							publicKey: tokenData.public_key,
							mercadoPagoUserId: tokenData.user_id.toString(),
							expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
							createdAt: new Date(),
							updatedAt: new Date(),
						},
					});

					return ctx.json({
						success: true,
						oauthToken: {
							id: oauthToken.id,
							mercadoPagoUserId: oauthToken.mercadoPagoUserId,
							expiresAt: oauthToken.expiresAt,
						},
					});
				},
			),

			// Create a reusable preapproval plan (subscription plan)
			createPreapprovalPlan: createAuthEndpoint(
				"/mercado-pago/plan/create",
				{
					method: "POST",
					body: z.object({
						reason: z.string(), // Plan description (e.g., "Premium Monthly")
						autoRecurring: z.object({
							frequency: z.number(), // 1, 7, 30, etc
							frequencyType: z.enum(["days", "months"]),
							transactionAmount: z.number(),
							currencyId: z.string().default("ARS"),
							freeTrial: z
								.object({
									frequency: z.number(),
									frequencyType: z.enum(["days", "months"]),
								})
								.optional(),
						}),
						repetitions: z.number().optional(), // null = infinite
						backUrl: z.string().optional(),
						metadata: z.record(z.any()).optional(),
					}),
				},
				async (ctx) => {
					const { reason, autoRecurring, repetitions, backUrl, metadata } =
						ctx.body;

					const baseUrl = options.baseUrl || ctx.context.baseURL;

					// Create preapproval plan
					const planBody: PreApprovalPlanCreateData["body"] = {
						reason,
						auto_recurring: {
							frequency: autoRecurring.frequency,
							frequency_type: autoRecurring.frequencyType,
							transaction_amount: autoRecurring.transactionAmount,
							currency_id: autoRecurring.currencyId,
						},
						back_url: backUrl || `${baseUrl}/plan/created`,
					};

					if (repetitions && planBody.auto_recurring) {
						planBody.auto_recurring.repetitions = repetitions;
					}

					if (autoRecurring.freeTrial && planBody.auto_recurring) {
						planBody.auto_recurring.free_trial = {
							frequency: autoRecurring.freeTrial.frequency,
							frequency_type: autoRecurring.freeTrial.frequencyType,
						};
					}

					const mpPlan = await preApprovalPlanClient.create({ body: planBody });

					// Save plan to database
					const plan = await ctx.context.adapter.create({
						model: "mercadoPagoPreapprovalPlan",
						data: {
							id: generateId(),
							mercadoPagoPlanId: mpPlan.id,
							reason,
							frequency: autoRecurring.frequency,
							frequencyType: autoRecurring.frequencyType,
							transactionAmount: autoRecurring.transactionAmount,
							currencyId: autoRecurring.currencyId,
							repetitions: repetitions || null,
							freeTrial: autoRecurring.freeTrial
								? JSON.stringify(autoRecurring.freeTrial)
								: null,
							metadata: JSON.stringify(metadata || {}),
							createdAt: new Date(),
							updatedAt: new Date(),
						},
					});

					return ctx.json({ plan });
				},
			),

			// List all preapproval plans
			listPreapprovalPlans: createAuthEndpoint(
				"/mercado-pago/plans",
				{
					method: "GET",
				},
				async (ctx) => {
					const plans = await ctx.context.adapter.findMany({
						model: "mercadoPagoPreapprovalPlan",
					});

					return ctx.json({ plans });
				},
			),

			// Create payment preference
			createPayment: createAuthEndpoint(
				"/mercado-pago/payment/create",
				{
					method: "POST",
					requireAuth: true,
					body: z.object({
						items: z
							.array(
								z.object({
									id: z.string(),
									title: z.string().min(1).max(256),
									quantity: z.number().int().min(1).max(10000),
									unitPrice: z.number().positive().max(999999999),
									currencyId: z.string().default("ARS"),
								}),
							)
							.min(1)
							.max(100),
						metadata: z.record(z.any()).optional(),
						marketplace: z
							.object({
								collectorId: z.string(),
								applicationFee: z.number().positive().optional(),
								applicationFeePercentage: z.number().min(0).max(100).optional(),
							})
							.optional(),
						successUrl: z.string().url().optional(),
						failureUrl: z.string().url().optional(),
						pendingUrl: z.string().url().optional(),
						idempotencyKey: z.string().optional(),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
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

					const {
						items,
						metadata,
						marketplace,
						successUrl,
						failureUrl,
						pendingUrl,
						idempotencyKey,
					} = ctx.body;

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

					// Validate URLs if provided
					if (options.trustedOrigins) {
						const urls = [successUrl, failureUrl, pendingUrl].filter(
							Boolean,
						) as string[];
						for (const url of urls) {
							if (!validateCallbackUrl(url, options.trustedOrigins)) {
								throw new APIError("FORBIDDEN", {
									message: `URL ${url} is not in trusted origins`,
								});
							}
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

					// Ensure customer exists
					let customer: MercadoPagoCustomerRecord | null =
						await ctx.context.adapter.findOne({
							model: "mercadoPagoCustomer",
							where: [{ field: "userId", value: session.user.id }],
						});

					if (!customer) {
						try {
							const mpCustomer = await customerClient.create({
								body: { email: session.user.email },
							});

							customer = await ctx.context.adapter.create({
								model: "mercadoPagoCustomer",
								data: {
									id: generateId(),
									userId: session.user.id,
									mercadoPagoId: mpCustomer.id,
									email: session.user.email,
									createdAt: new Date(),
									updatedAt: new Date(),
								},
							});
						} catch (error) {
							handleMercadoPagoError(error);
						}
					}

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

					// Calculate marketplace fees
					let applicationFeeAmount = 0;
					if (marketplace) {
						if (marketplace.applicationFee) {
							applicationFeeAmount = marketplace.applicationFee;
						} else if (marketplace.applicationFeePercentage) {
							applicationFeeAmount =
								(totalAmount * marketplace.applicationFeePercentage) / 100;
						}

						// Validate fee doesn't exceed total
						if (applicationFeeAmount >= totalAmount) {
							throw new APIError("BAD_REQUEST", {
								message: "Application fee cannot exceed total amount",
							});
						}
					}

					// Create preference with marketplace config
					const preferenceBody: PreferenceCreateData["body"] = {
						items: items.map((item) => ({
							id: item.id,
							title: item.title,
							quantity: item.quantity,
							unit_price: item.unitPrice,
							currency_id: item.currencyId,
						})),
						payer: {
							email: session.user.email,
						},
						back_urls: {
							success: successUrl || `${baseUrl}/payment/success`,
							failure: failureUrl || `${baseUrl}/payment/failure`,
							pending: pendingUrl || `${baseUrl}/payment/pending`,
						},
						notification_url: `${baseUrl}/api/auth/mercado-pago/webhook`,
						metadata: {
							...sanitizedMetadata,
							userId: session.user.id,
							customerId: customer?.id,
						},
						expires: true,
						expiration_date_from: new Date().toISOString(),
						expiration_date_to: new Date(
							Date.now() + 30 * 24 * 60 * 60 * 1000,
						).toISOString(), // 30 days
					};

					// Add marketplace config if provided
					if (marketplace) {
						preferenceBody.marketplace = marketplace.collectorId;
						preferenceBody.marketplace_fee = applicationFeeAmount;
					}

					let preference:
						| Awaited<ReturnType<typeof preferenceClient.create>>
						| undefined;
					try {
						preference = await preferenceClient.create({
							body: preferenceBody,
						});
					} catch (error) {
						handleMercadoPagoError(error);
					}

					// Save payment to database
					const payment = await ctx.context.adapter.create({
						model: "mercadoPagoPayment",
						data: {
							id: generateId(),
							userId: session.user.id,
							mercadoPagoPaymentId: preference.id,
							preferenceId: preference.id,
							status: "pending",
							amount: totalAmount,
							currency: items[0]?.currencyId || "ARS",
							metadata: JSON.stringify(sanitizedMetadata),
							createdAt: new Date(),
							updatedAt: new Date(),
						},
					});

					// Save marketplace split info if provided
					if (marketplace) {
						await ctx.context.adapter.create({
							model: "mercadoPagoMarketplaceSplit",
							data: {
								id: generateId(),
								paymentId: payment.id,
								collectorId: marketplace.collectorId,
								collectorEmail: "", // Will be updated via webhook
								applicationFeeAmount,
								applicationFeePercentage: marketplace.applicationFeePercentage,
								netAmount: totalAmount - applicationFeeAmount,
								metadata: JSON.stringify({}),
								createdAt: new Date(),
							},
						});
					}

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

			// Create subscription (supports both with and without preapproval plan)
			createSubscription: createAuthEndpoint(
				"/mercado-pago/subscription/create",
				{
					method: "POST",
					requireAuth: true,
					body: z.object({
						// Option 1: Use existing preapproval plan
						preapprovalPlanId: z.string().optional(),

						// Option 2: Create subscription directly without plan
						reason: z.string().optional(), // Description of subscription
						autoRecurring: z
							.object({
								frequency: z.number(), // 1 for monthly
								frequencyType: z.enum(["days", "months"]),
								transactionAmount: z.number(),
								currencyId: z.string().default("ARS"),
								startDate: z.string().optional(), // ISO date
								endDate: z.string().optional(), // ISO date
								freeTrial: z
									.object({
										frequency: z.number(),
										frequencyType: z.enum(["days", "months"]),
									})
									.optional(),
							})
							.optional(),
						backUrl: z.string().optional(),
						metadata: z.record(z.any()).optional(),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					const {
						preapprovalPlanId,
						reason,
						autoRecurring,
						backUrl,
						metadata,
					} = ctx.body;

					// Validate: must provide either preapprovalPlanId OR (reason + autoRecurring)
					if (!preapprovalPlanId) {
						if (!reason || !autoRecurring) {
							throw new APIError("BAD_REQUEST", {
								message:
									"Must provide either preapprovalPlanId or (reason + autoRecurring)",
							});
						}
					}

					// Ensure customer exists
					let customer = await ctx.context.adapter.findOne({
						model: "mercadoPagoCustomer",
						where: [{ field: "userId", value: session.user.id }],
					});

					if (!customer) {
						const mpCustomer = await customerClient.create({
							body: { email: session.user.email },
						});

						customer = await ctx.context.adapter.create({
							model: "mercadoPagoCustomer",
							data: {
								id: generateId(),
								userId: session.user.id,
								mercadoPagoId: mpCustomer.id,
								email: session.user.email,
								createdAt: new Date(),
								updatedAt: new Date(),
							},
						});
					}

					const baseUrl = options.baseUrl || ctx.context.baseURL;

					const subscriptionId = generateId();
					let preapproval:
						| Awaited<ReturnType<typeof preApprovalClient.create>>
						| undefined;

					// Option 1: Use existing preapproval plan
					if (preapprovalPlanId) {
						preapproval = await preApprovalClient.create({
							body: {
								preapproval_plan_id: preapprovalPlanId,
								payer_email: session.user.email,
								card_token_id: undefined, // Will be provided in checkout
								back_url: backUrl || `${baseUrl}/subscription/success`,
								status: "pending",
								external_reference: subscriptionId,
							},
						});
					}
					// Option 2: Create subscription directly without plan
					else if (autoRecurring) {
						// We verified autoRecurring is defined in the validation step above
						const ar = autoRecurring;
						const autoRecurringBody: PreApprovalCreateData["body"]["auto_recurring"] =
							{
								frequency: ar.frequency,
								frequency_type: ar.frequencyType,
								transaction_amount: ar.transactionAmount,
								currency_id: ar.currencyId,
							};

						if (ar.startDate) {
							autoRecurringBody.start_date = ar.startDate;
						}
						if (ar.endDate) {
							autoRecurringBody.end_date = ar.endDate;
						}
						if (ar.freeTrial) {
							// @ts-expect-error SDK type definition is missing free_trial
							autoRecurringBody.free_trial = {
								frequency: ar.freeTrial.frequency,
								frequency_type: ar.freeTrial.frequencyType,
							};
						}

						preapproval = await preApprovalClient.create({
							body: {
								reason: reason,
								auto_recurring: autoRecurringBody,
								payer_email: session.user.email,
								back_url: backUrl || `${baseUrl}/subscription/success`,
								status: "pending",
								external_reference: subscriptionId,
							},
						});
					}

					// Ensure preapproval was created
					if (!preapproval) {
						throw new APIError("BAD_REQUEST", {
							message: "Failed to create subscription",
						});
					}

					// Save subscription
					const subscription = await ctx.context.adapter.create({
						model: "mercadoPagoSubscription",
						data: {
							id: subscriptionId,
							userId: session.user.id,
							mercadoPagoSubscriptionId: preapproval.id,
							planId: preapprovalPlanId || reason || "direct",
							status: "pending",
							metadata: JSON.stringify(metadata || {}),
							createdAt: new Date(),
							updatedAt: new Date(),
						},
					});

					return ctx.json({
						checkoutUrl: preapproval.init_point,
						subscription,
					});
				},
			),

			// Cancel subscription
			cancelSubscription: createAuthEndpoint(
				"/mercado-pago/subscription/cancel",
				{
					method: "POST",
					requireAuth: true,
					body: z.object({
						subscriptionId: z.string(),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					const { subscriptionId } = ctx.body;

					const subscription: MercadoPagoSubscriptionRecord | null =
						await ctx.context.adapter.findOne({
							model: "mercadoPagoSubscription",
							where: [
								{ field: "id", value: subscriptionId },
								{ field: "userId", value: session.user.id },
							],
						});

					if (!subscription) {
						throw new APIError("NOT_FOUND", {
							message: "Subscription not found",
						});
					}

					// Cancel in Mercado Pago
					await preApprovalClient.update({
						id: subscription.mercadoPagoSubscriptionId,
						body: { status: "cancelled" },
					});

					// Update in database
					await ctx.context.adapter.update({
						model: "mercadoPagoSubscription",
						where: [{ field: "id", value: subscriptionId }],
						update: {
							status: "cancelled",
							updatedAt: new Date(),
						},
					});

					return ctx.json({ success: true });
				},
			),

			// Get payment status
			getPayment: createAuthEndpoint(
				"/mercado-pago/payment/:id",
				{
					method: "GET",
					requireAuth: true,
				},
				async (ctx) => {
					const paymentId = ctx.params.id;
					const session = ctx.context.session;

					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					const payment: MercadoPagoPaymentRecord | null =
						await ctx.context.adapter.findOne({
							model: "mercadoPagoPayment",
							where: [
								{ field: "id", value: paymentId },
								{ field: "userId", value: session.user.id },
							],
						});

					if (!payment) {
						throw new APIError("NOT_FOUND", {
							message: "Payment not found",
						});
					}

					return ctx.json({ payment });
				},
			),

			// List user payments
			listPayments: createAuthEndpoint(
				"/mercado-pago/payments",
				{
					method: "GET",
					requireAuth: true,
					query: z.object({
						limit: z.coerce.number().optional().default(10),
						offset: z.coerce.number().optional().default(0),
					}),
				},
				async (ctx) => {
					const session = ctx.context.session;
					const { limit, offset } = ctx.query;

					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					const payments = await ctx.context.adapter.findMany({
						model: "mercadoPagoPayment",
						where: [{ field: "userId", value: session.user.id }],
						limit,
						offset,
					});

					return ctx.json({ payments });
				},
			),

			// List user subscriptions
			listSubscriptions: createAuthEndpoint(
				"/mercado-pago/subscriptions",
				{
					method: "GET",
					requireAuth: true,
				},
				async (ctx) => {
					const session = ctx.context.session;

					if (!session) {
						throw new APIError("UNAUTHORIZED");
					}

					const subscriptions = await ctx.context.adapter.findMany({
						model: "mercadoPagoSubscription",
						where: [{ field: "userId", value: session.user.id }],
					});
					return ctx.json({ subscriptions });
				},
			),

			// Webhook handler
			webhook: createAuthEndpoint(
				"/mercado-pago/webhook",
				{
					method: "POST",
				},
				async (ctx) => {
					// Rate limiting for webhooks: 1000 requests per minute
					const webhookRateLimitKey = "webhook:global";
					if (!rateLimiter.check(webhookRateLimitKey, 1000, 60 * 1000)) {
						throw new APIError("TOO_MANY_REQUESTS", {
							message: "Webhook rate limit exceeded",
						});
					}

					let notification: {
						type?: string;
						data?: { id?: string };
					};
					try {
						notification = ctx.body;
					} catch {
						throw new APIError("BAD_REQUEST", {
							message: "Invalid JSON payload",
						});
					}

					// Validate webhook topic
					if (
						!notification.type ||
						!isValidWebhookTopic(notification.type) ||
						!notification.data?.id
					) {
						ctx.context.logger.warn("Invalid webhook topic received", {
							type: notification.type,
						});
						return ctx.json({ received: true }); // Return 200 to avoid retries
					}

					if (!ctx.request) {
						throw new APIError("BAD_REQUEST", {
							message: "Missing request",
						});
					}

					// Verify webhook signature
					if (options.webhookSecret) {
						const xSignature = ctx.request.headers.get("x-signature");
						const xRequestId = ctx.request.headers.get("x-request-id");
						const dataId = notification.data?.id?.toString();

						if (!dataId) {
							throw new APIError("BAD_REQUEST", {
								message: "Missing data.id in webhook payload",
							});
						}

						const isValid = verifyWebhookSignature({
							xSignature,
							xRequestId,
							dataId,
							secret: options.webhookSecret,
						});

						if (!isValid) {
							ctx.context.logger.error("Invalid webhook signature", {
								xSignature,
								xRequestId,
								dataId,
							});
							throw new APIError("UNAUTHORIZED", {
								message: "Invalid webhook signature",
							});
						}
					}

					// Idempotency: prevent duplicate webhook processing
					const webhookId = `webhook:${notification.data?.id}:${notification.type}`;
					const alreadyProcessed = idempotencyStore.get(webhookId);
					if (alreadyProcessed) {
						ctx.context.logger.info("Webhook already processed", { webhookId });
						return ctx.json({ received: true });
					}

					// Mark as being processed
					idempotencyStore.set(webhookId, true, 24 * 60 * 60 * 1000); // 24 hours

					try {
						// Handle payment notifications
						if (notification.type === "payment") {
							const paymentId = notification.data.id;

							if (!paymentId) {
								throw new APIError("BAD_REQUEST", {
									message: "Missing payment ID",
								});
							}

							// Fetch payment details from MP
							let mpPayment: MercadoPagoPaymentResponse;
							try {
								mpPayment = (await paymentClient.get({
									id: paymentId,
								})) as unknown as MercadoPagoPaymentResponse;
							} catch (error) {
								ctx.context.logger.error("Failed to fetch payment from MP", {
									paymentId,
									error,
								});
								throw new APIError("BAD_REQUEST", {
									message: "Failed to fetch payment details",
								});
							}

							// Update payment in database
							const existingPayment: MercadoPagoPaymentRecord | null =
								await ctx.context.adapter.findOne({
									model: "mercadoPagoPayment",
									where: [
										{
											field: "mercadoPagoPaymentId",
											value: paymentId.toString(),
										},
									],
								});

							if (existingPayment) {
								// Validate amount hasn't been tampered with
								if (
									!validatePaymentAmount(
										existingPayment.amount,
										mpPayment.transaction_amount || 0,
									)
								) {
									ctx.context.logger.error("Payment amount mismatch", {
										expected: existingPayment.amount,
										received: mpPayment.transaction_amount,
									});
									throw new APIError("BAD_REQUEST", {
										message: "Payment amount mismatch",
									});
								}

								await ctx.context.adapter.update({
									model: "mercadoPagoPayment",
									where: [{ field: "id", value: existingPayment.id }],
									update: {
										status: mpPayment.status,
										statusDetail: mpPayment.status_detail || undefined,
										paymentMethodId: mpPayment.payment_method_id || undefined,
										paymentTypeId: mpPayment.payment_type_id || undefined,
										updatedAt: new Date(),
									},
								});

								// Execute callback if provided
								if (options.onPaymentUpdate) {
									try {
										await options.onPaymentUpdate({
											payment: existingPayment,
											status: mpPayment.status,
											statusDetail: mpPayment.status_detail || "",
											mpPayment: mpPayment,
										});
									} catch (error) {
										ctx.context.logger.error(
											"Error in onPaymentUpdate callback",
											{ error },
										);
										// Don't throw - we still want to return 200
									}
								}
							}
						}

						// Handle subscription (preapproval) notifications
						if (
							notification.type === "subscription_preapproval" ||
							notification.type === "subscription_preapproval_plan"
						) {
							const preapprovalId = notification.data.id;

							if (!preapprovalId) {
								throw new APIError("BAD_REQUEST", {
									message: "Missing preapproval ID",
								});
							}

							// Fetch preapproval details
							let mpPreapproval: MercadoPagoPreApprovalResponse;
							try {
								mpPreapproval = (await preApprovalClient.get({
									id: preapprovalId,
								})) as unknown as MercadoPagoPreApprovalResponse;
							} catch (error) {
								ctx.context.logger.error(
									"Failed to fetch preapproval from MP",
									{ preapprovalId, error },
								);
								throw new APIError("BAD_REQUEST", {
									message: "Failed to fetch subscription details",
								});
							}

							const existingSubscription: MercadoPagoSubscriptionRecord | null =
								await ctx.context.adapter.findOne({
									model: "mercadoPagoSubscription",
									where: [
										{
											field: "mercadoPagoSubscriptionId",
											value: preapprovalId,
										},
									],
								});

							if (existingSubscription) {
								await ctx.context.adapter.update({
									model: "mercadoPagoSubscription",
									where: [{ field: "id", value: existingSubscription.id }],
									update: {
										status: mpPreapproval.status,
										reason: mpPreapproval.reason || undefined,
										nextPaymentDate: mpPreapproval.next_payment_date
											? new Date(mpPreapproval.next_payment_date)
											: undefined,
										lastPaymentDate: mpPreapproval.last_modified
											? new Date(mpPreapproval.last_modified)
											: undefined,
										summarized: mpPreapproval.summarized
											? JSON.stringify(mpPreapproval.summarized)
											: undefined,
										updatedAt: new Date(),
									},
								});

								// Execute callback if provided
								if (options.onSubscriptionUpdate) {
									try {
										await options.onSubscriptionUpdate({
											subscription: existingSubscription,
											status: mpPreapproval.status,
											reason: mpPreapproval.reason || "",
											mpPreapproval: mpPreapproval,
										});
									} catch (error) {
										ctx.context.logger.error(
											"Error in onSubscriptionUpdate callback",
											{ error },
										);
									}
								}
							}
						}

						// Handle authorized recurring payment
						if (
							(notification.type as string) ===
								"subscription_authorized_payment" ||
							(notification.type as string) === "authorized_payment"
						) {
							const paymentId = notification.data.id;

							if (!paymentId) {
								throw new APIError("BAD_REQUEST", {
									message: "Missing payment ID",
								});
							}

							// Handle recurring payment from subscription
							let mpPayment: MercadoPagoPaymentResponse;
							try {
								// Cast the response to our typed interface
								mpPayment = (await paymentClient.get({
									id: paymentId,
								})) as unknown as MercadoPagoPaymentResponse;
							} catch (error) {
								ctx.context.logger.error(
									"Failed to fetch authorized payment from MP",
									{ paymentId, error },
								);
								throw new APIError("BAD_REQUEST", {
									message: "Failed to fetch payment details",
								});
							}

							// Link via external_reference (which contains the subscription ID)
							if (mpPayment.external_reference) {
								const subscription: MercadoPagoSubscriptionRecord | null =
									await ctx.context.adapter.findOne({
										model: "mercadoPagoSubscription",
										where: [
											{
												field: "id",
												// External reference holds the local subscription ID
												value: mpPayment.external_reference,
											},
										],
									});

								if (subscription) {
									// Update subscription last payment date
									// Note: In real scenarios, you might want to create a payment record here too
									// or just rely on the webhook to create it if it doesn't exist.
									// For now, we update the subscription and trigger the callback.

									if (options.onSubscriptionPayment) {
										try {
											await options.onSubscriptionPayment({
												subscription,

												// In a real app, we should map this properly or align types
												payment: mpPayment,
												status: mpPayment.status,
											});
										} catch (error) {
											ctx.context.logger.error(
												"Error in onSubscriptionPayment callback",
												{ error },
											);
										}
									}
								} else {
									ctx.context.logger.warn(
										"Subscription not found for authorized payment",
										{
											paymentId,
											externalReference: mpPayment.external_reference,
										},
									);
								}
							}
						}
					} catch (error) {
						// Log error but return 200 to prevent MP from retrying
						ctx.context.logger.error("Error processing webhook", {
							error,
							notification,
						});

						// Only throw if it's a validation error that MP should know about
						if (error instanceof APIError) {
							throw error;
						}
					}

					return ctx.json({ received: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
};
