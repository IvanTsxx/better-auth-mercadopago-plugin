import { vi } from "vitest";

// Mock Mercado Pago SDK classes
export const mockPaymentCreate = vi.fn();
export const mockPreApprovalCreate = vi.fn();
export const mockPreApprovalPlanCreate = vi.fn();
export const mockPreferenceCreate = vi.fn();
export const mockCustomerCreate = vi.fn();
export const mockCustomerSearch = vi.fn();

// NOTE: This mock might be overridden by test files using vi.mock("mercadopago") again.
// To avoid hoisting issues, it's safer to mock in the test file itself if needed.
vi.mock("mercadopago", () => {
	return {
		MercadoPagoConfig: vi.fn(),
		Payment: vi.fn(() => ({
			create: mockPaymentCreate,
		})),
		PreApproval: vi.fn(() => ({
			create: mockPreApprovalCreate,
		})),
		PreApprovalPlan: vi.fn(() => ({
			create: mockPreApprovalPlanCreate,
		})),
		Preference: vi.fn(() => ({
			create: mockPreferenceCreate,
		})),
		Customer: vi.fn(() => ({
			create: mockCustomerCreate,
			search: mockCustomerSearch,
		})),
	};
});

// Mock Better Auth Context
export const mockAdapter = {
	create: vi.fn(),
	findOne: vi.fn(),
	findMany: vi.fn(),
	update: vi.fn(),
};

export const mockLogger = {
	error: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
};

export const createMockContext = (body: any = {}, session: any = {}) => ({
	body,
	context: {
		adapter: mockAdapter,
		logger: mockLogger,
		session: {
			user: {
				id: "user_123",
				email: "test@example.com",
				...session,
			},
		},
		baseURL: "http://localhost:3000",
	},
	headers: new Headers(),
	request: new Request("http://localhost:3000"),
	json: vi.fn((data) => data),
});
