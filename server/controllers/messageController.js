import axios from "axios"
import Chat from "../models/Chat.js"
import User from "../models/User.js"
import imagekit from "../configs/imageKit.js"
import openai from "../configs/openai.js"


// ============================================================
// TEXT MESSAGE CONTROLLER
// ============================================================

export const textMessageController = async (req, res) => {
    try {

        const userId = req.user._id

        // Check credits
        if (req.user.credits < 1) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            })
        }

        const { chatId, prompt } = req.body

        // Find chat
        const chat = await Chat.findOne({
            userId,
            _id: chatId
        })

        if (!chat) {
            return res.json({
                success: false,
                message: "Chat not found"
            })
        }

        // Save user message
        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        })

        // Generate AI response
        const { choices } = await openai.chat.completions.create({
            model: "gemini-3.7-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        })

        if (!choices || !choices[0] || !choices[0].message) {
            throw new Error("AI did not return a valid response")
        }

        const reply = {
            ...choices[0].message,
            timestamp: Date.now(),
            isImage: false
        }

        // Save assistant message
        chat.messages.push(reply)

        await chat.save()

        // Deduct 1 credit
        await User.updateOne(
            { _id: userId },
            {
                $inc: {
                    credits: -1
                }
            }
        )

        return res.json({
            success: true,
            reply
        })

    } catch (error) {

        console.error("TEXT MESSAGE ERROR:", error)

        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
}


// ============================================================
// IMAGE GENERATION MESSAGE CONTROLLER
// ============================================================

export const imageMessageController = async (req, res) => {
    try {

        const userId = req.user._id

        // Check credits
        if (req.user.credits < 2) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            })
        }

        const {
            prompt,
            chatId,
            isPublished
        } = req.body

        // Find chat
        const chat = await Chat.findOne({
            userId,
            _id: chatId
        })

        if (!chat) {
            return res.json({
                success: false,
                message: "Chat not found"
            })
        }

        // Push user message
        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        })


        // ========================================================
        // ORIGINAL IMAGE GENERATION LOGIC
        // ========================================================

        // Encode the prompt
        const encodedPrompt = encodeURIComponent(prompt)

        // Construct ImageKit AI generation URL
        const generatedImageUrl =
            `${process.env.IMAGEKIT_URL_ENDPOINT}/ik-genimg-prompt-${encodedPrompt}/quickgpt/${Date.now()}.png?tr=w-800,h-800`;

        console.log("=================================")
        console.log("IMAGEKIT GENERATED URL:")
        console.log(generatedImageUrl)
        console.log("=================================")

        // Trigger generation by fetching from ImageKit
        const aiImageResponse = await axios.get(
            generatedImageUrl,
            {
                responseType: "arraybuffer",
                timeout: 120000
            }
        )

        // Convert to Base64
        const base64Image =
            `data:image/png;base64,${Buffer
                .from(aiImageResponse.data, "binary")
                .toString("base64")}`

        // Upload to ImageKit Media Library
        const uploadResponse = await imagekit.upload({
            file: base64Image,
            fileName: `${Date.now()}.png`,
            folder: "quickgpt"
        })

        // ========================================================
        // IMAGE GENERATION LOGIC ENDS
        // ========================================================


        const reply = {
            role: "assistant",
            content: uploadResponse.url,
            timestamp: Date.now(),
            isImage: true,
            isPublished
        }

        // Save assistant message
        chat.messages.push(reply)

        await chat.save()

        // Deduct 2 credits
        await User.updateOne(
            { _id: userId },
            {
                $inc: {
                    credits: -2
                }
            }
        )

        return res.json({
            success: true,
            reply
        })

    } catch (error) {

        console.error("IMAGE GENERATION ERROR:", error)

        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
}