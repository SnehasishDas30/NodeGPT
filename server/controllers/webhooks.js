import Stripe from "stripe";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

export const stripeWebhooks = async (request, response) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const sig = request.headers["stripe-signature"];

    let event;

    // Verify Stripe webhook signature
    try {
        event = stripe.webhooks.constructEvent(
            request.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.error("Webhook signature error:", error.message);

        return response
            .status(400)
            .send(`Webhook Error: ${error.message}`);
    }

    try {
        switch (event.type) {

            // ==========================================
            // CHECKOUT COMPLETED
            // ==========================================
            case "checkout.session.completed": {

                const session = event.data.object;

                const metadata = session.metadata || {};

                const transactionId = metadata.transactionId;
                const appId = metadata.appId;

                console.log("Stripe checkout completed:", {
                    transactionId,
                    appId,
                    sessionId: session.id,
                    paymentStatus: session.payment_status
                });

                // Check application
                if (appId !== "quickgpt") {
                    console.log("Ignored event: Invalid appId", appId);

                    return response.json({
                        received: true,
                        message: "Ignored event: Invalid app"
                    });
                }

                // Check transaction ID
                if (!transactionId) {
                    console.error(
                        "Transaction ID missing from Stripe metadata"
                    );

                    return response.status(400).json({
                        received: false,
                        message: "Transaction ID missing from metadata"
                    });
                }

                // Find transaction
                const transaction = await Transaction.findById(
                    transactionId
                );

                if (!transaction) {
                    console.error(
                        "Transaction not found:",
                        transactionId
                    );

                    return response.status(404).json({
                        received: false,
                        message: "Transaction not found"
                    });
                }

                // Prevent duplicate credit
                if (transaction.isPaid === true) {
                    console.log(
                        "Transaction already processed:",
                        transactionId
                    );

                    return response.json({
                        received: true,
                        message: "Transaction already processed"
                    });
                }

                // Find user
                const user = await User.findById(
                    transaction.userId
                );

                if (!user) {
                    console.error(
                        "User not found:",
                        transaction.userId
                    );

                    return response.status(404).json({
                        received: false,
                        message: "User not found"
                    });
                }

                // ==========================================
                // ADD CREDITS
                // ==========================================

                const oldCredits = user.credits || 0;

                const creditsToAdd = transaction.credits || 0;

                user.credits = oldCredits + creditsToAdd;

                await user.save();

                // ==========================================
                // MARK TRANSACTION AS PAID
                // ==========================================

                transaction.isPaid = true;

                await transaction.save();

                console.log(
                    `Credits added successfully: +${creditsToAdd}`
                );

                console.log(
                    `User: ${user.email}`
                );

                console.log(
                    `Credits: ${oldCredits} -> ${user.credits}`
                );

                console.log(
                    `Transaction marked as paid: ${transactionId}`
                );

                break;
            }

            // ==========================================
            // PAYMENT INTENT SUCCEEDED
            // ==========================================
            case "payment_intent.succeeded": {

                const paymentIntent = event.data.object;

                console.log(
                    "Payment succeeded:",
                    paymentIntent.id
                );

                // IMPORTANT:
                // Credits are NOT added here.
                //
                // Credits are added only from
                // checkout.session.completed
                //
                // This prevents duplicate credits.

                break;
            }

            // ==========================================
            // OTHER STRIPE EVENTS
            // ==========================================
            default: {

                console.log(
                    "Unhandled event type:",
                    event.type
                );

                break;
            }
        }

        return response.json({
            received: true
        });

    } catch (error) {

        console.error(
            "Webhook processing error:",
            error
        );

        return response.status(500).json({
            received: false,
            message: "Internal Server Error"
        });
    }
};