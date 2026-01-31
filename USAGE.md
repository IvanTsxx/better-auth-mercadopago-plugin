// Example: Complete Next.js App with Mercado Pago Plugin

// ============================================
// 1. auth.ts (Server)
// ============================================
import { betterAuth } from "better-auth";
import { mercadoPago } from "better-auth-mercadopago";
import Database from "better-sqlite3";

export const auth = betterAuth({
	database: new Database("./db.sqlite"),
	emailAndPassword: {
		enabled: true,
	},
	plugins: [
		mercadoPago({
			accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
			baseUrl: process.env.APP_URL || "http://localhost:3000",

			// Handle payment status changes
			onPaymentUpdate: async ({ payment, status, mpPayment }) => {
				console.log(`💰 Payment ${payment.id} is now ${status}`);

				if (status === "approved") {
					// TODO: Grant premium access to user
					// TODO: Send confirmation email
					// TODO: Update user's subscription in your app
				}
			},
		}),
	],
});

// ============================================
// 2. auth-client.ts (Client)
// ============================================
import { createAuthClient } from "better-auth/client";
import { mercadoPagoClient } from "better-auth-mercadopago/client";

export const authClient = createAuthClient({
	baseURL: "http://localhost:3000",
	plugins: [mercadoPagoClient()],
});

// ============================================
// 3. Example: Simple Checkout Button
// ============================================
("use client");

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function BuyButton() {
	const [loading, setLoading] = useState(false);

	const handleBuy = async () => {
		setLoading(true);

		const { data, error } = await authClient.mercadopago.createPayment({
			items: [
				{
					title: "Premium Plan - Monthly",
					quantity: 1,
					unitPrice: 999.99,
					currencyId: "ARS",
				},
			],
			metadata: {
				plan: "premium",
				billingPeriod: "monthly",
			},
		});

		if (data) {
			// Redirect to Mercado Pago checkout
			window.location.href = data.checkoutUrl;
		} else {
			console.error(error);
			setLoading(false);
		}
	};

	return (
		<button onClick={handleBuy} disabled={loading}>
			{loading ? "Loading..." : "Buy Premium - $999.99"}
		</button>
	);
}

// ============================================
// 4. Example: Marketplace Split Payment
// ============================================
("use client");

import { authClient } from "@/lib/auth-client";

export function MarketplaceBuyButton({
	product,
	sellerEmail,
}: {
	product: { title: string; price: number };
	sellerEmail: string;
}) {
	const handleBuy = async () => {
		const { data } = await authClient.mercadoPago.createPayment({
			items: [
				{
					title: product.title,
					quantity: 1,
					unitPrice: product.price,
				},
			],
			// Split: 90% to seller, 10% to platform
			split: [
				{
					receiverEmail: sellerEmail,
					percentage: 90,
				},
				{
					receiverEmail: "platform@mymarketplace.com",
					percentage: 10,
				},
			],
			metadata: {
				productId: product.id,
				sellerId: product.sellerId,
			},
		});

		if (data) {
			window.location.href = data.checkoutUrl;
		}
	};

	return <button onClick={handleBuy}>Buy from Seller</button>;
}

// ============================================
// 5. Example: Subscription
// ============================================
("use client");

import { authClient } from "@/lib/auth-client";

export function SubscribeButton({ planId }: { planId: string }) {
	const handleSubscribe = async () => {
		const { data } = await authClient.mercadopago.createSubscription({
			planId,
			metadata: {
				source: "website",
			},
		});

		if (data) {
			window.location.href = data.checkoutUrl;
		}
	};

	return <button onClick={handleSubscribe}>Subscribe Now</button>;
}

// ============================================
// 6. Example: Payment History Page
// ============================================
("use client");

import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

export function PaymentHistory() {
	const { data, isLoading } = useQuery({
		queryKey: ["payments"],
		queryFn: async () => {
			const result = await authClient.mercadoPago.listPayments({
				limit: 50,
			});
			return result.data;
		},
	});

	if (isLoading) return <div>Loading...</div>;

	return (
		<div className="space-y-4">
			<h2>Payment History</h2>
			{data?.payments.map((payment) => (
				<div key={payment.id} className="border p-4 rounded">
					<div className="flex justify-between">
						<div>
							<p className="font-bold">${payment.amount}</p>
							<p className="text-sm text-gray-600">
								{new Date(payment.createdAt).toLocaleDateString()}
							</p>
						</div>
						<div>
							<span
								className={`px-2 py-1 rounded ${
									payment.status === "approved"
										? "bg-green-100 text-green-800"
										: payment.status === "pending"
											? "bg-yellow-100 text-yellow-800"
											: "bg-red-100 text-red-800"
								}`}
							>
								{payment.status}
							</span>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

// ============================================
// 7. Example: Success Page
// ============================================
("use client");

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function PaymentSuccessPage() {
	const searchParams = useSearchParams();
	const paymentId = searchParams.get("payment_id");
	const [payment, setPayment] = useState(null);

	useEffect(() => {
		if (paymentId) {
			authClient.mercadoPago.getPayment(paymentId).then(({ data }) => {
				setPayment(data?.payment);
			});
		}
	}, [paymentId]);

	return (
		<div className="text-center p-8">
			<h1>✅ Payment Successful!</h1>
			{payment && (
				<div>
					<p>Amount: ${payment.amount}</p>
					<p>Status: {payment.status}</p>
				</div>
			)}
		</div>
	);
}

// ============================================
// 8. Example: Multi-item Checkout
// ============================================
("use client");

import { authClient } from "@/lib/auth-client";

export function CartCheckout({ items }: { items: CartItem[] }) {
	const handleCheckout = async () => {
		const { data } = await authClient.mercadoPago.createPayment({
			items: items.map((item) => ({
				title: item.name,
				quantity: item.quantity,
				unitPrice: item.price,
			})),
			metadata: {
				cartId: "cart_123",
				items: items.map((i) => i.id),
			},
		});

		if (data) {
			window.location.href = data.checkoutUrl;
		}
	};

	const total = items.reduce(
		(sum, item) => sum + item.price * item.quantity,
		0,
	);

	return (
		<div>
			<div className="space-y-2">
				{items.map((item) => (
					<div key={item.id} className="flex justify-between">
						<span>
							{item.name} x {item.quantity}
						</span>
						<span>${item.price * item.quantity}</span>
					</div>
				))}
				<div className="border-t pt-2 font-bold">
					<div className="flex justify-between">
						<span>Total</span>
						<span>${total}</span>
					</div>
				</div>
			</div>
			<button
				onClick={handleCheckout}
				className="w-full mt-4 bg-blue-600 text-white py-2 rounded"
			>
				Checkout
			</button>
		</div>
	);
}

import { useMutation, useQuery } from "@tanstack/react-query";
// ============================================
// 9. Example: Custom Hook
// ============================================
import { authClient } from "@/lib/auth-client";

export function useMercadoPago() {
	const createPayment = useMutation({
		mutationFn: async (params) => {
			const { data } = await authClient.mercadoPago.createPayment(params);
			return data;
		},
		onSuccess: (data) => {
			if (data?.checkoutUrl) {
				window.location.href = data.checkoutUrl;
			}
		},
	});

	const payments = useQuery({
		queryKey: ["mercadopago-payments"],
		queryFn: async () => {
			const { data } = await authClient.mercadoPago.listPayments();
			return data?.payments || [];
		},
	});

	return {
		createPayment,
		payments,
	};
}

// Usage:
function MyComponent() {
	const { createPayment, payments } = useMercadoPago();

	return (
		<button
			onClick={() =>
				createPayment.mutate({
					items: [{ title: "Product", quantity: 1, unitPrice: 99 }],
				})
			}
		>
			Buy Now
		</button>
	);
}
