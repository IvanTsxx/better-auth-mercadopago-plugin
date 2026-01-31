import type {
	BetterAuthClientPlugin,
	BetterFetchOption,
} from "better-auth/client";
import type { mercadoPagoPlugin } from "./index";
import type {
	CreatePaymentParams,
	CreatePaymentResponse,
	CreatePreapprovalPlanParams,
	CreatePreapprovalPlanResponse,
	CreateSubscriptionParams,
	CreateSubscriptionResponse,
	MercadoPagoCustomerRecord,
	MercadoPagoPaymentRecord,
	MercadoPagoPreapprovalPlanRecord,
	MercadoPagoSubscriptionRecord,
	OAuthTokenResponse,
	OAuthUrlResponse,
} from "./types";

export interface MercadoPagoClientActions {
	/**
	 * Get or create a Mercado Pago customer for the authenticated user
	 */
	getOrCreateCustomer: (
		data?: {
			email?: string;
			firstName?: string;
			lastName?: string;
		},
		fetchOptions?: BetterFetchOption,
	) => Promise<{ customer: MercadoPagoCustomerRecord }>;

	/**
	 * Create a payment and get checkout URL
	 */
	createPayment: (
		data: CreatePaymentParams,
		fetchOptions?: BetterFetchOption,
	) => Promise<CreatePaymentResponse>;

	/**
	 * Create a marketplace payment with automatic split
	 */
	createMarketplacePayment: (
		data: CreatePaymentParams,
		fetchOptions?: BetterFetchOption,
	) => Promise<CreatePaymentResponse>;

	/**
	 * Create a subscription with recurring payments
	 */
	createSubscription: (
		data: CreateSubscriptionParams,
		fetchOptions?: BetterFetchOption,
	) => Promise<CreateSubscriptionResponse>;

	/**
	 * Cancel a subscription
	 */
	cancelSubscription: (
		data: { subscriptionId: string },
		fetchOptions?: BetterFetchOption,
	) => Promise<{ success: boolean }>;

	/**
	 * Create a reusable preapproval plan (subscription template)
	 */
	createPreapprovalPlan: (
		data: CreatePreapprovalPlanParams,
		fetchOptions?: BetterFetchOption,
	) => Promise<CreatePreapprovalPlanResponse>;

	/**
	 * List all preapproval plans
	 */
	listPreapprovalPlans: (
		fetchOptions?: BetterFetchOption,
	) => Promise<{ plans: MercadoPagoPreapprovalPlanRecord[] }>;

	/**
	 * Get payment by ID
	 */
	getPayment: (
		paymentId: string,
		fetchOptions?: BetterFetchOption,
	) => Promise<{ payment: MercadoPagoPaymentRecord }>;

	/**
	 * List all payments for the authenticated user
	 */
	listPayments: (
		params?: { limit?: number; offset?: number },
		fetchOptions?: BetterFetchOption,
	) => Promise<{ payments: MercadoPagoPaymentRecord[] }>;

	/**
	 * List all subscriptions for the authenticated user
	 */
	listSubscriptions: (
		fetchOptions?: BetterFetchOption,
	) => Promise<{ subscriptions: MercadoPagoSubscriptionRecord[] }>;

	/**
	 * Get OAuth authorization URL for marketplace sellers
	 */
	getOAuthUrl: (
		params: { redirectUri: string },
		fetchOptions?: BetterFetchOption,
	) => Promise<OAuthUrlResponse>;

	/**
	 * Exchange OAuth code for access token
	 */
	exchangeOAuthCode: (
		data: { code: string; redirectUri: string },
		fetchOptions?: BetterFetchOption,
	) => Promise<OAuthTokenResponse>;
}

// Export the actions type for Better Auth type inference
export type MercadoPagoClient = MercadoPagoClientActions;

export const mercadoPagoClient = () => {
	return {
		id: "mercadopago",
		$InferServerPlugin: {} as ReturnType<typeof mercadoPagoPlugin>,

		getActions: ($fetch: any): MercadoPagoClientActions => ({
			/**
			 * Get or create a Mercado Pago customer for the authenticated user
			 */
			getOrCreateCustomer: async (
				data?: {
					email?: string;
					firstName?: string;
					lastName?: string;
				},
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/customer", {
					method: "POST",
					body: data || {},
					...fetchOptions,
				});
			},

			/**
			 * Create a payment and get checkout URL
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.createPayment({
			 *   items: [{
			 *     title: "Premium Plan",
			 *     quantity: 1,
			 *     unitPrice: 99.90,
			 *     currencyId: "ARS"
			 *   }]
			 * });
			 *
			 * // Redirect user to checkout
			 * window.location.href = data.checkoutUrl;
			 * ```
			 */
			createPayment: async (
				data: CreatePaymentParams,
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/payment/create", {
					method: "POST",
					body: data,
					...fetchOptions,
				});
			},

			/**
			 * Create a marketplace payment with automatic split
			 *
			 * You need to have the seller's MP User ID (collector_id) which they get
			 * after authorizing your app via OAuth.
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.createPayment({
			 *   items: [{
			 *     title: "Product from Seller",
			 *     quantity: 1,
			 *     unitPrice: 100
			 *   }],
			 *   marketplace: {
			 *     collectorId: "123456789", // Seller's MP User ID
			 *     applicationFeePercentage: 10 // Platform keeps 10%
			 *   }
			 * });
			 * ```
			 */
			createMarketplacePayment: async (
				data: CreatePaymentParams,
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/payment/create", {
					method: "POST",
					body: data,
					...fetchOptions,
				});
			},

			/**
			 * Create a subscription with recurring payments
			 *
			 * Supports two modes:
			 * 1. With preapproval plan (reusable): Pass preapprovalPlanId
			 * 2. Direct subscription (one-off): Pass reason + autoRecurring
			 *
			 * @example With plan
			 * ```ts
			 * const { data } = await authClient.mercadoPago.createSubscription({
			 *   preapprovalPlanId: "plan_abc123"
			 * });
			 * ```
			 *
			 * @example Direct (without plan)
			 * ```ts
			 * const { data } = await authClient.mercadoPago.createSubscription({
			 *   reason: "Premium Monthly Plan",
			 *   autoRecurring: {
			 *     frequency: 1,
			 *     frequencyType: "months",
			 *     transactionAmount: 99.90,
			 *     currencyId: "ARS"
			 *   }
			 * });
			 * ```
			 */
			createSubscription: async (
				data: CreateSubscriptionParams,
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/subscription/create", {
					method: "POST",
					body: data,
					...fetchOptions,
				});
			},

			/**
			 * Cancel a subscription
			 *
			 * @example
			 * ```ts
			 * await authClient.mercadoPago.cancelSubscription({
			 *   subscriptionId: "sub_123"
			 * });
			 * ```
			 */
			cancelSubscription: async (
				data: { subscriptionId: string },
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/subscription/cancel", {
					method: "POST",
					body: data,
					...fetchOptions,
				});
			},

			/**
			 * Create a reusable preapproval plan (subscription template)
			 *
			 * Plans can be reused for multiple subscriptions. Create once,
			 * use many times with createSubscription({ preapprovalPlanId })
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.createPreapprovalPlan({
			 *   reason: "Premium Monthly",
			 *   autoRecurring: {
			 *     frequency: 1,
			 *     frequencyType: "months",
			 *     transactionAmount: 99.90,
			 *     freeTrial: {
			 *       frequency: 7,
			 *       frequencyType: "days"
			 *     }
			 *   },
			 *   repetitions: 12 // 12 months, omit for infinite
			 * });
			 *
			 * // Use the plan
			 * const planId = data.plan.mercadoPagoPlanId;
			 * ```
			 */
			createPreapprovalPlan: async (
				data: CreatePreapprovalPlanParams,
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/plan/create", {
					method: "POST",
					body: data,
					...fetchOptions,
				});
			},

			/**
			 * List all preapproval plans
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.listPreapprovalPlans();
			 *
			 * data.plans.forEach(plan => {
			 *   console.log(plan.reason); // "Premium Monthly"
			 *   console.log(plan.transactionAmount); // 99.90
			 * });
			 * ```
			 */
			listPreapprovalPlans: async (fetchOptions?: BetterFetchOption) => {
				return await $fetch("/mercado-pago/plans", {
					method: "GET",
					...fetchOptions,
				});
			},

			/**
			 * Get payment by ID
			 */
			getPayment: async (
				paymentId: string,
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch(`/mercado-pago/payment/${paymentId}`, {
					method: "GET",
					...fetchOptions,
				});
			},

			/**
			 * List all payments for the authenticated user
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.listPayments({
			 *   limit: 20,
			 *   offset: 0
			 * });
			 * ```
			 */
			listPayments: async (
				params?: { limit?: number; offset?: number },
				fetchOptions?: BetterFetchOption,
			) => {
				const query = new URLSearchParams();
				if (params?.limit) query.set("limit", params.limit.toString());
				if (params?.offset) query.set("offset", params.offset.toString());

				return await $fetch(`/mercado-pago/payments?${query.toString()}`, {
					method: "GET",
					...fetchOptions,
				});
			},

			/**
			 * List all subscriptions for the authenticated user
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.listSubscriptions();
			 * ```
			 */
			listSubscriptions: async (fetchOptions?: BetterFetchOption) => {
				return await $fetch(`/mercado-pago/subscriptions`, {
					method: "GET",
					...fetchOptions,
				});
			},

			/**
			 * Get OAuth authorization URL for marketplace sellers
			 *
			 * This is Step 1 of OAuth flow. Redirect the seller to this URL so they
			 * can authorize your app to process payments on their behalf.
			 *
			 * @example
			 * ```ts
			 * const { data } = await authClient.mercadoPago.getOAuthUrl({
			 *   redirectUri: "https://myapp.com/oauth/callback"
			 * });
			 *
			 * // Redirect seller to authorize
			 * window.location.href = data.authUrl;
			 * ```
			 */
			getOAuthUrl: async (
				params: { redirectUri: string },
				fetchOptions?: BetterFetchOption,
			) => {
				const query = new URLSearchParams();
				query.set("redirectUri", params.redirectUri);

				return await $fetch(
					`/mercado-pago/oauth/authorize?${query.toString()}`,
					{
						method: "GET",
						...fetchOptions,
					},
				);
			},

			/**
			 * Exchange OAuth code for access token
			 *
			 * This is Step 2 of OAuth flow. After the seller authorizes and MP redirects
			 * them back with a code, exchange that code for an access token.
			 *
			 * @example
			 * ```ts
			 * // In your /oauth/callback page:
			 * const code = new URLSearchParams(window.location.search).get("code");
			 *
			 * const { data } = await authClient.mercadoPago.exchangeOAuthCode({
			 *   code,
			 *   redirectUri: "https://myapp.com/oauth/callback"
			 * });
			 *
			 * // Now you have the seller's MP User ID
			 * console.log(data.oauthToken.mercadoPagoUserId);
			 * ```
			 */
			exchangeOAuthCode: async (
				data: { code: string; redirectUri: string },
				fetchOptions?: BetterFetchOption,
			) => {
				return await $fetch("/mercado-pago/oauth/callback", {
					method: "POST",
					body: data,
					...fetchOptions,
				});
			},
		}),
	} satisfies BetterAuthClientPlugin;
};
