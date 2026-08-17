import axios from "axios";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import ImageKit from "imagekit";
import openai from "../configs/openai.js";

// ============================================================
// IMAGEKIT INSTANCE
// ============================================================

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

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

        if (Number(req.user.credits) < 1) {
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

        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        });

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

        chat.messages.push(reply);

        await chat.save();

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
        console.log("IMAGE GENERATION START");
        console.log("=================================");

        // --------------------------------------------------------
        // Authentication
        // --------------------------------------------------------

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated"
            });
        }

        const userId = req.user._id;

        console.log("User ID:", userId);
        console.log("User Credits:", req.user.credits);

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

        if (!prompt || !chatId) {
            return res.json({
                success: false,
                message: "Prompt and chat ID are required"
            });
        }

        console.log("Prompt:", prompt);
        console.log("Chat ID:", chatId);

        // --------------------------------------------------------
        // Find chat
        // --------------------------------------------------------

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

        // --------------------------------------------------------
        // Environment check
        // --------------------------------------------------------

        const publicKey =
            process.env.IMAGEKIT_PUBLIC_KEY?.trim();

        const privateKey =
            process.env.IMAGEKIT_PRIVATE_KEY?.trim();

        const urlEndpoint =
            process.env.IMAGEKIT_URL_ENDPOINT
                ?.trim()
                .replace(/\/+$/, "");

        console.log("=================================");
        console.log("IMAGEKIT CONFIG");
        console.log("=================================");
        console.log(
            "Public Key:",
            publicKey ? "Present" : "MISSING"
        );
        console.log(
            "Private Key:",
            privateKey ? "Present" : "MISSING"
        );
        console.log(
            "URL Endpoint:",
            urlEndpoint || "MISSING"
        );
        console.log("=================================");

        if (!publicKey) {
            throw new Error(
                "IMAGEKIT_PUBLIC_KEY is missing"
            );
        }

        if (!privateKey) {
            throw new Error(
                "IMAGEKIT_PRIVATE_KEY is missing"
            );
        }

        if (!urlEndpoint) {
            throw new Error(
                "IMAGEKIT_URL_ENDPOINT is missing"
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
        // Generate unique file path
        // --------------------------------------------------------

        const fileName =
            `quickgpt-${Date.now()}.png`;

        // --------------------------------------------------------
        // IMPORTANT
        //
        // ImageKit AI generation syntax:
        //
        // /ik-genimg-prompt-{prompt}/{filename}
        //
        // We use ImageKit's URL helper to create a SIGNED URL.
        // This is important if AI transformations are restricted
        // to signed URLs in ImageKit security settings.
        // --------------------------------------------------------

        const imagePath =
            `/ik-genimg-prompt-${String(prompt).trim()}/${fileName}`;

        console.log("=================================");
        console.log("IMAGEKIT IMAGE PATH");
        console.log(imagePath);
        console.log("=================================");

        // --------------------------------------------------------
        // Create signed ImageKit URL
        // --------------------------------------------------------

        let generatedImageUrl;

        try {
            generatedImageUrl = imagekit.url({
                path: imagePath,
                signed: true,
                expireSeconds: 300
            });
        } catch (urlError) {
            console.error(
                "IMAGEKIT URL GENERATION ERROR:",
                urlError
            );

            throw new Error(
                `Failed to create ImageKit signed URL: ${urlError.message}`
            );
        }

        console.log("=================================");
        console.log("SIGNED IMAGEKIT URL CREATED");
        console.log(generatedImageUrl);
        console.log("=================================");

        // --------------------------------------------------------
        // Request generated image
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
            console.error("IMAGEKIT REQUEST FAILED");
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
        // ImageKit still generating
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
        // Handle ImageKit error
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
            console.error("IMAGEKIT ERROR");
            console.error("=================================");
            console.error(
                "Status:",
                imageResponse.status
            );
            console.error(
                "Content-Type:",
                contentType
            );
            console.error(
                "Response:",
                errorText
            );
            console.error(
                "IK Error:",
                imageResponse.headers["ik-error"] || "None"
            );
            console.error(
                "Generated URL:",
                generatedImageUrl
            );
            console.error("=================================");

            throw new Error(
                `ImageKit returned ${imageResponse.status} ${contentType}`
            );
        }

        // --------------------------------------------------------
        // Image successfully generated
        // --------------------------------------------------------

        console.log("=================================");
        console.log("IMAGE GENERATED SUCCESSFULLY");
        console.log("=================================");

        // --------------------------------------------------------
        // Assistant reply
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
        // Deduct credits
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
        console.log("2 CREDITS DEDUCTED");
        console.log("=================================");

        // --------------------------------------------------------
        // Response
        // --------------------------------------------------------

        return res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("=================================");
        console.error("IMAGE GENERATION ERROR");
        console.error("=================================");
        console.error("Message:", error.message);
        console.error("Stack:", error.stack);
        console.error("=================================");

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};