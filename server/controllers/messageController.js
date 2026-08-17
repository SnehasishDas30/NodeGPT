import axios from "axios";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import openai from "../configs/openai.js";

// ============================================================
// TEXT MESSAGE CONTROLLER
// ============================================================

export const textMessageController = async (req, res) => {
    try {
        console.log("=================================");
        console.log("TEXT MESSAGE CONTROLLER START");
        console.log("=================================");

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated"
            });
        }

        const userId = req.user._id;

        // Check credits
        if (req.user.credits < 1) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            });
        }

        const { chatId, prompt } = req.body;

        if (!chatId || !prompt) {
            return res.json({
                success: false,
                message: "Chat ID and prompt are required"
            });
        }

        // Find chat
        const chat = await Chat.findOne({
            userId,
            _id: chatId
        });

        if (!chat) {
            return res.json({
                success: false,
                message: "Chat not found"
            });
        }

        // Save user message
        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        });

        // Generate AI response
        const { choices } = await openai.chat.completions.create({
            model: "gemini-3.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        if (!choices || !choices[0] || !choices[0].message) {
            throw new Error("AI did not return a valid response");
        }

        const reply = {
            ...choices[0].message,
            timestamp: Date.now(),
            isImage: false
        };

        // Save assistant message
        chat.messages.push(reply);

        await chat.save();

        // Deduct credit
        await User.updateOne(
            { _id: userId },
            {
                $inc: {
                    credits: -1
                }
            }
        );

        return res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("=================================");
        console.error("TEXT MESSAGE ERROR");
        console.error(error);
        console.error("=================================");

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// ============================================================
// IMAGE GENERATION MESSAGE CONTROLLER
// ============================================================

export const imageMessageController = async (req, res) => {
    try {
        console.log("=================================");
        console.log("IMAGE CONTROLLER START");
        console.log("=================================");

        // --------------------------------------------------------
        // Authentication check
        // --------------------------------------------------------

        if (!req.user) {
            console.error("IMAGE ERROR: req.user is missing");

            return res.status(401).json({
                success: false,
                message: "User not authenticated"
            });
        }

        const userId = req.user._id;

        console.log("IMAGE USER ID:", userId);
        console.log("IMAGE USER CREDITS:", req.user.credits);

        // --------------------------------------------------------
        // Credit check
        // --------------------------------------------------------

        if (Number(req.user.credits) < 2) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            });
        }

        // --------------------------------------------------------
        // Request body
        // --------------------------------------------------------

        const {
            prompt,
            chatId,
            isPublished
        } = req.body;

        console.log("IMAGE CHAT ID:", chatId);
        console.log("IMAGE PROMPT:", prompt);

        if (!prompt || !chatId) {
            return res.json({
                success: false,
                message: "Prompt and chat ID are required"
            });
        }

        // --------------------------------------------------------
        // Find chat
        // --------------------------------------------------------

        const chat = await Chat.findOne({
            userId,
            _id: chatId
        });

        if (!chat) {
            console.error("IMAGE ERROR: Chat not found");

            return res.json({
                success: false,
                message: "Chat not found"
            });
        }

        // --------------------------------------------------------
        // ImageKit environment variables
        // --------------------------------------------------------

        const imageKitEndpoint = process.env.IMAGEKIT_URL_ENDPOINT
            ?.trim()
            .replace(/\/+$/, "");

        const imageKitPublicKey =
            process.env.IMAGEKIT_PUBLIC_KEY?.trim();

        const imageKitPrivateKey =
            process.env.IMAGEKIT_PRIVATE_KEY?.trim();

        console.log("=================================");
        console.log("IMAGEKIT CONFIG CHECK");
        console.log(
            "IMAGEKIT URL:",
            imageKitEndpoint || "MISSING"
        );
        console.log(
            "IMAGEKIT PUBLIC KEY:",
            imageKitPublicKey ? "Present" : "Missing"
        );
        console.log(
            "IMAGEKIT PRIVATE KEY:",
            imageKitPrivateKey ? "Present" : "Missing"
        );
        console.log("=================================");

        if (!imageKitEndpoint) {
            throw new Error(
                "IMAGEKIT_URL_ENDPOINT is missing"
            );
        }

        if (!imageKitPublicKey) {
            throw new Error(
                "IMAGEKIT_PUBLIC_KEY is missing"
            );
        }

        if (!imageKitPrivateKey) {
            throw new Error(
                "IMAGEKIT_PRIVATE_KEY is missing"
            );
        }

        // --------------------------------------------------------
        // Save user prompt
        // --------------------------------------------------------

        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        });

        // --------------------------------------------------------
        // Encode prompt
        // --------------------------------------------------------

        const encodedPrompt = encodeURIComponent(
            String(prompt).trim()
        );

        // --------------------------------------------------------
        // Generate unique filename
        // --------------------------------------------------------

        const fileName =
            `quickgpt-${Date.now()}.png`;

        // --------------------------------------------------------
        // ImageKit AI generation URL
        // --------------------------------------------------------

        const generatedImageUrl =
            `${imageKitEndpoint}/ik-genimg-prompt-${encodedPrompt}/${fileName}`;

        console.log("=================================");
        console.log("IMAGEKIT GENERATED URL:");
        console.log(generatedImageUrl);
        console.log("=================================");

        // --------------------------------------------------------
        // Request image from ImageKit
        // --------------------------------------------------------

        let imageResponse;

        try {
            imageResponse = await axios.get(
                generatedImageUrl,
                {
                    responseType: "arraybuffer",
                    validateStatus: () => true,
                    timeout: 120000
                }
            );
        } catch (axiosError) {
            console.error("=================================");
            console.error("IMAGEKIT AXIOS ERROR");
            console.error("Message:", axiosError.message);
            console.error("Code:", axiosError.code);
            console.error("=================================");

            throw new Error(
                `ImageKit request failed: ${axiosError.message}`
            );
        }

        const contentType =
            imageResponse.headers["content-type"] || "";

        const intermediateResponse =
            String(
                imageResponse.headers[
                    "is-intermediate-response"
                ] || ""
            ).toLowerCase() === "true";

        console.log("=================================");
        console.log("IMAGEKIT RESPONSE");
        console.log("Status:", imageResponse.status);
        console.log("Content-Type:", contentType);
        console.log(
            "Intermediate:",
            intermediateResponse
        );
        console.log("=================================");

        // --------------------------------------------------------
        // Handle intermediate response
        // --------------------------------------------------------

        if (
            imageResponse.status === 200 &&
            intermediateResponse
        ) {
            return res.status(202).json({
                success: false,
                message:
                    "ImageKit is still generating the image. Please try again in a moment."
            });
        }

        // --------------------------------------------------------
        // Handle ImageKit errors
        // --------------------------------------------------------

        if (
            imageResponse.status !== 200 ||
            !contentType.startsWith("image/")
        ) {
            let errorText = "";

            try {
                errorText = Buffer
                    .from(imageResponse.data)
                    .toString("utf8")
                    .slice(0, 2000);
            } catch {
                errorText =
                    "Unable to read ImageKit response";
            }

            console.error("=================================");
            console.error("IMAGEKIT ERROR RESPONSE");
            console.error("Status:", imageResponse.status);
            console.error("Content-Type:", contentType);
            console.error("Response:", errorText);
            console.error(
                "ImageKit Error Header:",
                imageResponse.headers["ik-error"] || "None"
            );
            console.error("URL:", generatedImageUrl);
            console.error("=================================");

            throw new Error(
                `ImageKit returned ${imageResponse.status} ${contentType}`
            );
        }

        // --------------------------------------------------------
        // Image successfully generated
        // --------------------------------------------------------

        console.log("=================================");
        console.log("IMAGEKIT IMAGE GENERATED SUCCESSFULLY");
        console.log("Image URL:", generatedImageUrl);
        console.log("=================================");

        // --------------------------------------------------------
        // Save assistant response
        //
        // IMPORTANT:
        // ImageKit AI generated image is already available
        // at generatedImageUrl.
        // No second imagekit.upload() call is required here.
        // --------------------------------------------------------

        const reply = {
            role: "assistant",
            content: generatedImageUrl,
            timestamp: Date.now(),
            isImage: true,
            isPublished: Boolean(isPublished)
        };

        // --------------------------------------------------------
        // Save assistant message
        // --------------------------------------------------------

        chat.messages.push(reply);

        await chat.save();

        // --------------------------------------------------------
        // Deduct 2 credits
        // --------------------------------------------------------

        await User.updateOne(
            { _id: userId },
            {
                $inc: {
                    credits: -2
                }
            }
        );

        console.log("=================================");
        console.log("IMAGE GENERATION SUCCESS");
        console.log("Credits deducted: 2");
        console.log("=================================");

        // --------------------------------------------------------
        // Send response
        // --------------------------------------------------------

        return res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("=================================");
        console.error("IMAGE GENERATION ERROR");
        console.error("Message:", error.message);
        console.error("Stack:", error.stack);
        console.error("=================================");

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};