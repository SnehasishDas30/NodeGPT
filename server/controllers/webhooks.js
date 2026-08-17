import Stripe from "stripe";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

export const stripeWebhooks = async (request, response) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sig = request.headers["stripe-signature"];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            request.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.error("Webhook signature error:", error.message);
        return response.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
        switch (event.type) {

            case "checkout.session.completed": {

                const session = event.data.object;

                const { transactionId, appId } = session.metadata || {};

                console.log("Stripe checkout completed:", {
                    transactionId,
                    appId,
                    sessionId: session.id
                });

                if (appId !== "quickgpt") {
                    return response.json({
                        received: true,
                        message: "Ignored event: Invalid app"
                    });
                }

                if (!transactionId) {
                    return response.status(400).json({
                        received: false,
                        message: "Transaction ID missing from metadata"
                    });
                }

                const transaction = await Transaction.findOne({
                    _id: transactionId,
                    isPaid: false
                });

                if (!transaction) {
                    return response.json({
                        received: true,
                        message: "Transaction already processed or not found"
                    });
                }

                // Add credits to user
                await User.updateOne(
                    { _id: transaction.userId },
                    { $inc: { credits: transaction.credits } }
                );

                // Mark transaction as paid
                transaction.isPaid = true;
                await transaction.save();

                console.log(
                    `Added ${transaction.credits} credits to user ${transaction.userId}`
                );

                break;
            }

            default:
                console.log("Unhandled event type:", event.type);
        }

        return response.json({ received: true });

    } catch (error) {
        console.error("Webhook processing error:", error);
        return response.status(500).send("Internal Server Error");
    }
};