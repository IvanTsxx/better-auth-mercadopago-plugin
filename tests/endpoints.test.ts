import { beforeEach, describe, expect, it, vi } from "vitest";

// Define mocks before importing the module that uses them
const mockPaymentCreate = vi.fn();
const mockPreApprovalCreate = vi.fn();
const mockPreApprovalPlanCreate = vi.fn();
const mockPreferenceCreate = vi.fn();
const mockCustomerCreate = vi.fn();
const mockCustomerSearch = vi.fn();

// Mock Mercado Pago SDK classes using class syntax to support `new`
vi.mock("mercadopago", () => {
	return {
		MercadoPagoConfig: class {},
		Payment: class {
			create = mockPaymentCreate;
		},
		PreApproval: class {
			create = mockPreApprovalCreate;
		},
		PreApprovalPlan: class {
			create = mockPreApprovalPlanCreate;
		},
		Preference: class {
			create = mockPreferenceCreate;
		},
		Customer: class {
			create = mockCustomerCreate;
			search = mockCustomerSearch;
		},
	};
});

// Mock better-auth/api to capture the handler
vi.mock("better-auth/api", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...(actual as any),
		createAuthEndpoint: (path: string, options: any, handler: any) => {
			return { path, options, handler };
		},
		APIError: class extends Error {
			constructor(
				public status: string,
				public message: string,
			) {
				super(message);
			}
		},
	};
});

// Import after mocking
import { mercadoPagoPlugin } from "../index";
import { createMockContext, mockAdapter } from "./mocks";

describe("Mercado Pago Plugin Endpoints", () => {
	const plugin = mercadoPagoPlugin({
		accessToken: "TEST_ACCESS_TOKEN",
		baseUrl: "https://mysite.com",
	});

	const findEndpoint = (path: string, method: "GET" | "POST") => {
		const endpoints = plugin.endpoints ? Object.values(plugin.endpoints) : [];
		return endpoints.find(
			(e: any) => e.path === path && e.options?.method === method,
		);
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createPayment", () => {
		it("should create a preference and return checkoutUrl", async () => {
			const endpoint = findEndpoint("/mercado-pago/payment/create", "POST");
			expect(endpoint).toBeDefined();

			const mockPreferenceResponse = {
				id: "pref_123",
				init_point: "https://mp.com/checkout/123",
				sandbox_init_point: "https://sandbox.mp.com/checkout/123",
			};
			mockPreferenceCreate.mockResolvedValue(mockPreferenceResponse);

			mockAdapter.findOne.mockResolvedValue({
				id: "customer_123",
				mercadoPagoId: "mp_cust_123",
			});
			mockAdapter.create.mockImplementation((args) =>
				Promise.resolve({ ...args.data, id: "payment_123" }),
			);

			const ctx = createMockContext({
				items: [
					{
						title: "Test Item",
						unitPrice: 100,
						quantity: 1,
						currencyId: "ARS",
						id: "item_1",
					},
				],
				successUrl: "https://mysite.com/success",
			});

			// Now endpoint.handler should exist due to our mock
			const handler = (endpoint as any).handler;
			const result = await handler(ctx);

			expect(mockPreferenceCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					body: expect.objectContaining({
						items: expect.arrayContaining([
							expect.objectContaining({
								title: "Test Item",
								unit_price: 100,
							}),
						]),
						back_urls: expect.objectContaining({
							success: "https://mysite.com/success",
						}),
					}),
				}),
			);

			expect(result).toHaveProperty(
				"checkoutUrl",
				"https://mp.com/checkout/123",
			);
			expect(result).toHaveProperty("preferenceId", "pref_123");
		});
	});

	describe("createSubscription", () => {
		it("should create a subscription with autoRecurring logic (no preapproval plan)", async () => {
			const endpoint = findEndpoint(
				"/mercado-pago/subscription/create",
				"POST",
			);
			expect(endpoint).toBeDefined();

			mockPreApprovalCreate.mockResolvedValue({
				id: "sub_123",
				init_point: "https://mp.com/sub/123",
				external_reference: "local_sub_id",
			});

			mockAdapter.findOne.mockResolvedValue({
				id: "customer_123",
				mercadoPagoId: "mp_cust_123",
			});
			mockAdapter.create.mockImplementation((args) =>
				Promise.resolve({ ...args.data, id: args.data.id || "sub_db_123" }),
			);

			const ctx = createMockContext({
				reason: "Monthly Sub",
				autoRecurring: {
					frequency: 1,
					frequencyType: "months",
					transactionAmount: 10,
					currencyId: "ARS",
				},
				backUrl: "http://app.com/cb",
			});

			const handler = (endpoint as any).handler;
			const result = await handler(ctx);

			expect(mockPreApprovalCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					body: expect.objectContaining({
						reason: "Monthly Sub",
						auto_recurring: expect.objectContaining({
							frequency: 1,
							transaction_amount: 10,
						}),
						external_reference: expect.any(String),
					}),
				}),
			);

			expect(result).toHaveProperty("checkoutUrl", "https://mp.com/sub/123");
		});

		it("should create a subscription using an existing preapproval plan", async () => {
			const endpoint = findEndpoint(
				"/mercado-pago/subscription/create",
				"POST",
			);
			expect(endpoint).toBeDefined();

			mockPreApprovalCreate.mockResolvedValue({
				id: "sub_456",
				init_point: "https://mp.com/sub/456",
				external_reference: "local_sub_id_2",
			});

			mockAdapter.findOne.mockResolvedValue({
				id: "customer_123",
				mercadoPagoId: "mp_cust_123",
			});
			mockAdapter.create.mockImplementation((args) =>
				Promise.resolve({ ...args.data, id: args.data.id || "sub_db_456" }),
			);

			const ctx = createMockContext({
				preapprovalPlanId: "plan_xyz",
				backUrl: "http://app.com/cb",
			});

			const handler = (endpoint as any).handler;
			await handler(ctx);

			expect(mockPreApprovalCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					body: expect.objectContaining({
						preapproval_plan_id: "plan_xyz",
						external_reference: expect.any(String),
					}),
				}),
			);
		});
	});
});
