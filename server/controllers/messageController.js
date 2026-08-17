import axios from "axios";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import imagekit from "../configs/imageKit.js";
import openai from "../configs/openai.js";

// Text-based AI chat message controller
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

        // Save user's message
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

        const reply = {
            ...choices[0].message,
            timestamp: Date.now(),
            isImage: false
        };

        res.json({
            success: true,
            reply
        });

        // Save assistant message
        chat.messages.push(reply);
        await chat.save();

        // Deduct credit
        await User.updateOne(
            { _id: userId },
            { $inc: { credits: -1 } }
        );

    } catch (error) {
        console.error("TEXT MESSAGE ERROR:", error);

        res.json({
            success: false,
            message: error.message
        });
    }
};


// Image Generation Message Controller
export const imageMessageController = async (req, res) => {
    try {
        const userId = req.user._id;

        // Check credits
        if (req.user.credits < 2) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            });
        }

        const { prompt, chatId, isPublished } = req.body;

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

        // Save user's prompt
        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        });

        // Encode prompt
        const encodedPrompt = encodeURIComponent(prompt);

        // Unique image path
        const imagePath = `quickgpt/${Date.now()}.png`;

        // ImageKit AI image generation URL
        const generatedImageUrl =
            `${process.env.IMAGEKIT_URL_ENDPOINT}/ik-genimg-prompt-${encodedPrompt}/${imagePath}?tr=w-800,h-800`;

        console.log("=================================");
        console.log("IMAGEKIT GENERATED URL:");
        console.log(generatedImageUrl);
        console.log("=================================");

        // Poll ImageKit until image is ready
        let imageResponse = null;
        let attempts = 0;
        const maxAttempts = 60;

        while (attempts < maxAttempts) {
            attempts++;

            try {
                imageResponse = await axios.get(generatedImageUrl, {
                    responseType: "arraybuffer",
                    validateStatus: () => true
                });
            } catch (axiosError) {
                console.error(
                    "IMAGEKIT AXIOS ERROR:",
                    axiosError.message
                );

                throw new Error(
                    `ImageKit request failed: ${axiosError.message}`
                );
            }

            const contentType =
                imageResponse.headers["content-type"] || "";

            const isIntermediate =
                String(
                    imageResponse.headers["is-intermediate-response"]
                ).toLowerCase() === "true";

            console.log(
                `IMAGEKIT ATTEMPT ${attempts}:`,
                imageResponse.status,
                contentType,
                "intermediate:",
                isIntermediate
            );

            // Image successfully generated
            if (
                imageResponse.status === 200 &&
                contentType.startsWith("image/")
            ) {
                console.log("IMAGEKIT IMAGE READY");
                break;
            }

            // ImageKit is still processing
            if (
                imageResponse.status === 200 &&
                isIntermediate
            ) {
                console.log(
                    `ImageKit still processing... attempt ${attempts}`
                );

                await new Promise(resolve =>
                    setTimeout(resolve, 2000)
                );

                continue;
            }

            // Get readable error response
            let errorText = "";

            try {
                errorText = Buffer
                    .from(imageResponse.data)
                    .toString("utf8")
                    .slice(0, 1000);
            } catch {
                errorText = "Unable to read ImageKit response";
            }

            console.error("=================================");
            console.error("IMAGEKIT ERROR");
            console.error("Status:", imageResponse.status);
            console.error("Content-Type:", contentType);
            console.error("Response:", errorText);
            console.error("URL:", generatedImageUrl);
            console.error("=================================");

            throw new Error(
                `ImageKit returned ${imageResponse.status} ${contentType}`
            );
        }

        // No response
        if (!imageResponse) {
            throw new Error(
                "Image generation failed. No response from ImageKit."
            );
        }

        // Check final content type
        const finalContentType =
            imageResponse.headers["content-type"] || "";

        if (
            imageResponse.status !== 200 ||
            !finalContentType.startsWith("image/")
        ) {
            throw new Error(
                "Image generation timed out. ImageKit did not return an image."
            );
        }

        console.log(
            "Final ImageKit response:",
            imageResponse.status,
            finalContentType
        );

        // Convert image to Base64
        const base64Image =
            `data:${finalContentType};base64,${Buffer
                .from(imageResponse.data)
                .toString("base64")}`;

        // Upload generated image to ImageKit Media Library
        console.log("Uploading generated image to ImageKit...");

        const uploadResponse = await imagekit.upload({
            file: base64Image,
            fileName: `${Date.now()}.png`,
            folder: "quickgpt"
        });

        console.log(
            "ImageKit upload successful:",
            uploadResponse.url
        );

        // Assistant reply
        const reply = {
            role: "assistant",
            content: uploadResponse.url,
            timestamp: Date.now(),
            isImage: true,
            isPublished
        };

        // Send response
        res.json({
            success: true,
            reply
        });

        // Save assistant message
        chat.messages.push(reply);
        await chat.save();

        // Deduct credits
        await User.updateOne(
            { _id: userId },
            { $inc: { credits: -2 } }
        );

    } catch (error) {
        console.error("=================================");
        console.error("IMAGE GENERATION ERROR:");
        console.error(error);
        console.error("=================================");

        return res.json({
            success: false,
            message: error.message
        });
    }
};