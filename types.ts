import type { Payment, PreApproval } from "mercadopago";

export interface MercadoPagoPluginOptions {
	/**
	 * Your Mercado Pago access token
	 */
	accessToken: string;

	/**
	 * Base URL for redirects and webhooks
	 * @default process.env.APP_URL
	 */
	baseUrl?: string;

	/**
	 * Webhook secret for signature verification (optional)
	 */
	webhookSecret?: string;

	/**
	 * App ID for OAuth (required for marketplace features)
	 * Get it from: https://www.mercadopago.com/developers/panel/app
	 */
	appId?: string;

	/**
	 * App Secret for OAuth (required for marketplace features)
	 */
	appSecret?: string;

	/**
	 * Trusted origins for OAuth redirects
	 */
	trustedOrigins?: string[];

	/**
	 * Callback executed when a payment status changes
	 */
	onPaymentUpdate?: (data: {
		payment: MercadoPagoPaymentRecord;
		status: string;
		statusDetail: string;
		mpPayment: MercadoPagoPaymentResponse;
	}) => void | Promise<void>;

	/**
	 * Callback executed when a subscription status changes
	 */
	onSubscriptionUpdate?: (data: {
		subscription: MercadoPagoSubscriptionRecord;
		status: string;
		reason: string;
		mpPreapproval: MercadoPagoPreApprovalResponse;
	}) => void | Promise<void>;

	/**
	 * Callback executed when a recurring payment is processed (monthly, etc.)
	 */
	onSubscriptionPayment?: (data: {
		subscription: MercadoPagoSubscriptionRecord;
		payment: MercadoPagoPaymentResponse;
		status: string;
	}) => void | Promise<void>;
}

export interface MercadoPagoCustomerRecord {
	id: string;
	userId: string;
	mercadoPagoId: string;
	email: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface MercadoPagoPaymentRecord {
	id: string;
	userId: string;
	mercadoPagoPaymentId: string;
	preferenceId: string;
	status: string;
	amount: number;
	currency: string;
	metadata?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface MercadoPagoSubscriptionRecord {
	id: string;
	userId: string;
	mercadoPagoSubscriptionId: string;
	planId: string;
	status: string; // authorized, paused, cancelled, pending
	reason?: string;
	nextPaymentDate?: Date;
	lastPaymentDate?: Date;
	summarized?: string; // JSON with payment summary
	metadata?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface MercadoPagoMarketplaceSplitRecord {
	id: string;
	paymentId: string;
	collectorId: string; // MP User ID who receives money (seller)
	collectorEmail: string;
	applicationFeeAmount?: number; // Platform commission (absolute)
	applicationFeePercentage?: number; // Platform commission (percentage)
	netAmount: number; // Amount that goes to collector
	metadata?: string;
	createdAt: Date;
}

export interface MercadoPagoOAuthTokenRecord {
	id: string;
	userId: string;
	accessToken: string;
	refreshToken: string;
	publicKey: string;
	mercadoPagoUserId: string;
	expiresAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface MercadoPagoPreapprovalPlanRecord {
	id: string;
	mercadoPagoPlanId: string;
	reason: string;
	frequency: number;
	frequencyType: string;
	transactionAmount: number;
	currencyId: string;
	repetitions?: number;
	freeTrial?: string; // JSON
	metadata?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface PaymentItem {
	id: string;
	title: string;
	quantity: number;
	unitPrice: number;
	currencyId?: string;
}

export interface MarketplaceConfig {
	collectorId: string; // MP User ID of the seller who receives the money
	applicationFee?: number; // Fixed platform commission in currency units
	applicationFeePercentage?: number; // Platform commission as percentage (0-100)
}

export interface CreatePaymentParams {
	items: PaymentItem[];
	metadata?: Record<string, any>;
	marketplace?: MarketplaceConfig; // For marketplace/multi-vendor payments
	successUrl?: string;
	failureUrl?: string;
	pendingUrl?: string;
}

export interface CreateSubscriptionParams {
	// Option 1: Use existing preapproval plan
	preapprovalPlanId?: string;

	// Option 2: Create subscription directly without plan
	reason?: string; // Description of what the subscription is for
	autoRecurring?: {
		frequency: number; // 1 for monthly, 7 for weekly, etc
		frequencyType: "days" | "months";
		transactionAmount: number;
		currencyId?: string;
		startDate?: string; // ISO date string
		endDate?: string; // ISO date string
		freeTrial?: {
			frequency: number;
			frequencyType: "days" | "months";
		};
	};
	backUrl?: string;
	metadata?: Record<string, any>;
}

export interface CreatePreapprovalPlanParams {
	reason: string; // Plan name/description
	autoRecurring: {
		frequency: number;
		frequencyType: "days" | "months";
		transactionAmount: number;
		currencyId?: string;
		freeTrial?: {
			frequency: number;
			frequencyType: "days" | "months";
		};
	};
	repetitions?: number; // null/undefined = infinite
	backUrl?: string;
	metadata?: Record<string, any>;
}

export interface CreatePreapprovalPlanResponse {
	plan: MercadoPagoPreapprovalPlanRecord;
}

export interface CreatePaymentResponse {
	checkoutUrl: string;
	preferenceId: string;
	payment: MercadoPagoPaymentRecord;
}

export interface CreateSubscriptionResponse {
	checkoutUrl: string;
	subscription: MercadoPagoSubscriptionRecord;
}

export interface OAuthUrlResponse {
	authUrl: string;
}

export interface OAuthTokenResponse {
	success: boolean;
	oauthToken: {
		id: string;
		mercadoPagoUserId: string;
		expiresAt: Date;
	};
}

export interface MercadoPagoPaymentResponse {
	id: number;
	date_created: string;
	date_approved: string;
	date_last_updated: string;
	money_release_date: string;
	payment_method_id: string;
	payment_type_id: string;
	status: string;
	status_detail: string;
	currency_id: string;
	description: string;
	live_mode: boolean;
	sponsor_id: number;
	authorization_code: string;
	integrator_id: string;
	taxes_amount: number;
	counter_currency: string;
	operation_type: string;
	additional_info: {
		items: {
			id: string;
			title: string;
			description: string;
			picture_url: string;
			category_id: string;
			quantity: string;
			unit_price: string;
		}[];
		payer: {
			first_name: string;
			last_name: string;
			phone: {
				area_code: string;
				number: string;
			};
		};
		ip_address: string;
	};
	external_reference: string;
	transaction_amount: number;
	transaction_amount_refunded: number;
	coupon_amount: number;
	installments: number;
	transaction_details: {
		net_received_amount: number;
		total_paid_amount: number;
		overpaid_amount: number;
		external_resource_url: string;
		installment_amount: number;
		financial_institution: string;
		payment_method_reference_id: string;
	};
}

export interface MercadoPagoPreApprovalResponse {
	id: string;
	payer_id: number;
	payer_email: string;
	back_url: string;
	collector_id: number;
	application_id: number;
	status: string;
	reason: string;
	external_reference: string;
	date_created: string;
	last_modified: string;
	init_point: string;
	auto_recurring: {
		frequency: number;
		frequency_type: string;
		transaction_amount: number;
		currency_id: string;
		start_date: string;
		end_date: string;
		free_trial?: {
			frequency: number;
			frequency_type: string;
		};
	};
	summarized?: {
		quotas: number;
		charged_quantity: number;
		pending_charge_quantity: number;
		charged_amount: number;
		pending_charge_amount: number;
		semester: number;
		year: number;
	};
	next_payment_date: string;
	payment_method_id: string;
}
