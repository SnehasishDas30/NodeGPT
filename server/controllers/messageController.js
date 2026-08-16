import axios from "axios"
import Chat from "../models/Chat.js"
import User from "../models/User.js"
import imagekit from "../configs/imageKit.js"
import openai from '../configs/openai.js'

// Text-based AI chat message controller
export const textMessageController = async (req, res) => {
    try {
        const userId = req.user._id

        // check credits
        if (req.user.credits < 1) {
            return res.json({ success: false, message: "You don't have enough credits to use this feature" })
        }

        const { chatId, prompt } = req.body

        const chat = await Chat.findOne({ userId, _id: chatId })
        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        })

        const { choices } = await openai.chat.completions.create({
            model: "gemini-3.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });

        const reply = {
            ...choices[0].message,
            timestamp: Date.now(),
            isImage: false
        }

        res.json({ success: true, reply })

        chat.messages.push(reply)
        await chat.save()

        await User.updateOne(
            { _id: userId },
            { $inc: { credits: -1 } }
        )

    } catch (error) {
        res.json({ success: false, message: error.message })
    }
}


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

        // Encode the prompt
        const encodedPrompt = encodeURIComponent(prompt);

        // Create a unique image path
        const imagePath = `quickgpt/${Date.now()}.png`;

        // ImageKit AI image generation URL
        const generatedImageUrl =
            `${process.env.IMAGEKIT_URL_ENDPOINT}/ik-genimg-prompt-${encodedPrompt}/${imagePath}?tr=w-800,h-800`;

        console.log("IMAGEKIT GENERATED URL:", generatedImageUrl);

        // ImageKit AI transformations can take time.
        // Poll until the actual image is ready.
        let imageResponse = null;
        let attempts = 0;
        const maxAttempts = 60;

        while (attempts < maxAttempts) {
            attempts++;

            imageResponse = await axios.get(generatedImageUrl, {
                responseType: "arraybuffer",
                validateStatus: () => true
            });

            const contentType =
                imageResponse.headers["content-type"] || "";

            const isIntermediate =
                String(imageResponse.headers["is-intermediate-response"])
                    .toLowerCase() === "true";

            console.log(
                `IMAGEKIT ATTEMPT ${attempts}:`,
                imageResponse.status,
                contentType,
                "intermediate:",
                isIntermediate
            );

            // Actual image is ready
            if (
                imageResponse.status === 200 &&
                contentType.startsWith("image/")
            ) {
                break;
            }

            // ImageKit is still preparing the image
            if (
                imageResponse.status === 200 &&
                isIntermediate
            ) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            // Unexpected response
            const errorText = Buffer
                .from(imageResponse.data)
                .toString("utf8")
                .slice(0, 500);

            console.error("IMAGEKIT RESPONSE:", errorText);

            throw new Error(
                `ImageKit returned ${imageResponse.status} ${contentType}`
            );
        }

        // Make sure an actual image was returned
        if (!imageResponse) {
            throw new Error("Image generation failed.");
        }

        const finalContentType =
            imageResponse.headers["content-type"] || "";

        if (!finalContentType.startsWith("image/")) {
            throw new Error(
                "Image generation timed out. ImageKit did not return an image."
            );
        }

        // Convert generated image to Base64
        const base64Image =
            `data:${finalContentType};base64,${Buffer
                .from(imageResponse.data)
                .toString("base64")}`;

        // Upload generated image to ImageKit Media Library
        const uploadResponse = await imagekit.upload({
            file: base64Image,
            fileName: `${Date.now()}.png`,
            folder: "quickgpt"
        });

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
        console.error("IMAGE GENERATION ERROR:", error);

        res.json({
            success: false,
            message: error.message
        });
    }
};