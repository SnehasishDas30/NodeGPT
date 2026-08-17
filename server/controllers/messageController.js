import axios from "axios";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import imagekit from "../configs/imageKit.js";
import openai from "../configs/openai.js";

// ============================================================
// TEXT MESSAGE CONTROLLER
// ============================================================

export const textMessageController = async (req, res) => {
    try {
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

        if (!choices || !choices[0]) {
            throw new Error("AI did not return a response");
        }

        const reply = {
            ...choices[0].message,
            timestamp: Date.now(),
            isImage: false
        };

        // Save assistant message
        chat.messages.push(reply);

        await chat.save();

        // Deduct 1 credit
        await User.updateOne(
            { _id: userId },
            { $inc: { credits: -1 } }
        );

        return res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("TEXT MESSAGE ERROR:", error);

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
        const userId = req.user._id;

        // --------------------------------------------------------
        // Check credits
        // --------------------------------------------------------

        if (req.user.credits < 2) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            });
        }

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
        // Save user prompt
        // --------------------------------------------------------

        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        });

        // --------------------------------------------------------
        // Check ImageKit URL endpoint
        // --------------------------------------------------------

        const imageKitEndpoint =
            process.env.IMAGEKIT_URL_ENDPOINT?.replace(/\/+$/, "");

        if (!imageKitEndpoint) {
            throw new Error(
                "IMAGEKIT_URL_ENDPOINT is missing from environment variables"
            );
        }

        console.log("=================================");
        console.log("IMAGEKIT CONFIG CHECK");
        console.log(
            "IMAGEKIT URL:",
            imageKitEndpoint
        );
        console.log(
            "IMAGEKIT PUBLIC KEY:",
            process.env.IMAGEKIT_PUBLIC_KEY
                ? "Present"
                : "Missing"
        );
        console.log(
            "IMAGEKIT PRIVATE KEY:",
            process.env.IMAGEKIT_PRIVATE_KEY
                ? "Present"
                : "Missing"
        );
        console.log("=================================");

        // --------------------------------------------------------
        // Encode prompt
        // --------------------------------------------------------

        const encodedPrompt = encodeURIComponent(
            String(prompt).trim()
        );

        // --------------------------------------------------------
        // Unique image filename
        // --------------------------------------------------------

        const fileName =
            `quickgpt-${Date.now()}.png`;

        // --------------------------------------------------------
        // ImageKit AI generation URL
        // --------------------------------------------------------

        const generatedImageUrl =
            `${imageKitEndpoint}/ik-genimg-prompt-${encodedPrompt}/${fileName}`;

        console.log("=================================");
        console.log("IMAGEKIT GENERATED IMAGE URL:");
        console.log(generatedImageUrl);
        console.log("=================================");

        // --------------------------------------------------------
        // Request generated image
        // --------------------------------------------------------

        const imageResponse = await axios.get(
            generatedImageUrl,
            {
                responseType: "arraybuffer",
                validateStatus: () => true,
                timeout: 120000
            }
        );

        const contentType =
            imageResponse.headers["content-type"] || "";

        const intermediateResponse =
            String(
                imageResponse.headers[
                    "is-intermediate-response"
                ]
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
        // ImageKit may return an intermediate response
        // --------------------------------------------------------

        if (
            imageResponse.status === 200 &&
            intermediateResponse
        ) {
            throw new Error(
                "ImageKit is still generating the image. Please try again."
            );
        }

        // --------------------------------------------------------
        // Check if ImageKit returned an actual image
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

        console.log(
            "ImageKit image generated successfully"
        );

        // --------------------------------------------------------
        // Convert image to Base64
        // --------------------------------------------------------

        const base64Image =
            `data:${contentType};base64,${Buffer
                .from(imageResponse.data)
                .toString("base64")}`;

        // --------------------------------------------------------
        // Upload image to ImageKit Media Library
        // --------------------------------------------------------

        console.log(
            "Uploading generated image to ImageKit..."
        );

        const uploadResponse =
            await imagekit.upload({
                file: base64Image,
                fileName,
                folder: "quickgpt"
            });

        console.log(
            "ImageKit upload successful:",
            uploadResponse.url
        );

        // --------------------------------------------------------
        // Create assistant reply
        // --------------------------------------------------------

        const reply = {
            role: "assistant",
            content: uploadResponse.url,
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
        console.error(error);
        console.error("=================================");

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};