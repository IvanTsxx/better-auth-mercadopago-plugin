import { describe, expect, it, vi } from "vitest";
import { mercadoPagoPlugin } from "../index";

describe("mercadopago plugin", () => {
	it("should return the correct plugin structure", () => {
		const plugin = mercadoPagoPlugin({
			accessToken: "test_token",
			onSubscriptionUpdate: async () => {}, // Mock callback
		});

		expect(plugin).toHaveProperty("id", "mercado-pago");
		expect(plugin).toHaveProperty("endpoints");
		expect(plugin.endpoints).toHaveProperty("createSubscription");
		// Add more checks based on actual implementation
	});

	it("should throw error if config is missing", () => {
		// Test validation logic if any
	});
});
