
import axios from "axios"
import Chat from "../models/Chat.js"
import User from "../models/User.js"
import imagekit from "../configs/imageKit.js"
import openai from "../configs/openai.js"


// ============================================================
// HELPER - WAIT
// ============================================================

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}


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

        if (!chatId || !prompt) {
            return res.json({
                success: false,
                message: "Chat ID and prompt are required"
            })
        }

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
                    content: prompt
                }
            ]
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

        console.log("=================================")
        console.log("IMAGE GENERATION START")
        console.log("=================================")

        // --------------------------------------------------------
        // USER
        // --------------------------------------------------------

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated"
            })
        }

        const userId = req.user._id

        // --------------------------------------------------------
        // CREDIT CHECK
        // --------------------------------------------------------

        if (Number(req.user.credits) < 2) {
            return res.json({
                success: false,
                message: "You don't have enough credits to use this feature"
            })
        }

        // --------------------------------------------------------
        // REQUEST BODY
        // --------------------------------------------------------

        const {
            prompt,
            chatId,
            isPublished
        } = req.body

        if (!prompt || !chatId) {
            return res.json({
                success: false,
                message: "Prompt and chat ID are required"
            })
        }

        // --------------------------------------------------------
        // FIND CHAT
        // --------------------------------------------------------

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

        // --------------------------------------------------------
        // IMAGEKIT URL
        // --------------------------------------------------------

        const imageKitEndpoint =
            process.env.IMAGEKIT_URL_ENDPOINT
                ?.trim()
                .replace(/\/+$/, "")

        if (!imageKitEndpoint) {
            throw new Error(
                "IMAGEKIT_URL_ENDPOINT is missing"
            )
        }

        // --------------------------------------------------------
        // ENCODE PROMPT
        // --------------------------------------------------------

        const encodedPrompt = encodeURIComponent(
            String(prompt).trim()
        )

        // --------------------------------------------------------
        // UNIQUE FILE NAME
        // --------------------------------------------------------

        const fileName =
            `quickgpt-${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 8)}.png`

        // --------------------------------------------------------
        // IMAGEKIT AI GENERATION URL
        // --------------------------------------------------------

        const generatedImageUrl =
            `${imageKitEndpoint}/ik-genimg-prompt-${encodedPrompt}/quickgpt/${fileName}?tr=w-800,h-800`

        console.log("=================================")
        console.log("IMAGEKIT GENERATED URL")
        console.log(generatedImageUrl)
        console.log("=================================")

        // --------------------------------------------------------
        // POLL IMAGEKIT
        // --------------------------------------------------------

        let imageResponse = null

        const maxAttempts = 30

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {

            console.log(
                `IMAGEKIT ATTEMPT ${attempt}/${maxAttempts}`
            )

            try {

                imageResponse = await axios.get(
                    generatedImageUrl,
                    {
                        responseType: "arraybuffer",
                        validateStatus: () => true,
                        timeout: 120000,
                        headers: {
                            Accept: "image/*"
                        }
                    }
                )

            } catch (axiosError) {

                console.error(
                    "IMAGEKIT REQUEST ERROR:",
                    axiosError.message
                )

                if (attempt === maxAttempts) {
                    throw new Error(
                        `ImageKit request failed: ${axiosError.message}`
                    )
                }

                await sleep(2000)

                continue
            }

            const status =
                imageResponse.status

            const contentType =
                imageResponse.headers["content-type"] || ""

            const intermediate =
                String(
                    imageResponse.headers[
                        "is-intermediate-response"
                    ] || ""
                ).toLowerCase() === "true"

            const ikError =
                imageResponse.headers["ik-error"] || ""

            console.log(
                "Status:",
                status,
                "Content-Type:",
                contentType,
                "Intermediate:",
                intermediate
            )

            // ----------------------------------------------------
            // IMAGE READY
            // ----------------------------------------------------

            if (
                status === 200 &&
                contentType.startsWith("image/")
            ) {

                console.log(
                    "IMAGEKIT IMAGE READY"
                )

                break
            }

            // ----------------------------------------------------
            // IMAGEKIT STILL GENERATING
            // ----------------------------------------------------

            if (
                status === 200 &&
                intermediate
            ) {

                console.log(
                    "IMAGEKIT IS STILL GENERATING..."
                )

                await sleep(3000)

                continue
            }

            // ----------------------------------------------------
            // IMAGEKIT QUOTA ERROR
            // ----------------------------------------------------

            if (
                status === 403 &&
                ikError.includes("ELIMIT")
            ) {

                throw new Error(
                    "ImageKit AI generation limit has been reached. Please wait for your ImageKit AI/Extension Units to reset or upgrade your ImageKit plan."
                )
            }

            // ----------------------------------------------------
            // OTHER IMAGEKIT ERROR
            // ----------------------------------------------------

            if (status !== 200) {

                let errorText = ""

                try {

                    errorText =
                        Buffer
                            .from(imageResponse.data)
                            .toString("utf8")
                            .slice(0, 1000)

                } catch {

                    errorText =
                        "Unable to read ImageKit error response"
                }

                console.error(
                    "IMAGEKIT ERROR:",
                    status,
                    contentType,
                    ikError,
                    errorText
                )

                throw new Error(
                    `ImageKit returned ${status} ${contentType}`
                )
            }

            // ----------------------------------------------------
            // UNKNOWN RESPONSE
            // ----------------------------------------------------

            console.log(
                "ImageKit returned an unexpected response."
            )

            await sleep(3000)
        }

        // --------------------------------------------------------
        // FINAL RESPONSE VALIDATION
        // --------------------------------------------------------

        if (!imageResponse) {
            throw new Error(
                "Image generation failed. ImageKit returned no response."
            )
        }

        const finalContentType =
            imageResponse.headers["content-type"] || ""

        if (
            imageResponse.status !== 200 ||
            !finalContentType.startsWith("image/")
        ) {

            throw new Error(
                "Image generation timed out. ImageKit did not return an image."
            )
        }

        console.log(
            "IMAGEKIT IMAGE GENERATED SUCCESSFULLY"
        )

        // --------------------------------------------------------
        // CONVERT IMAGE TO BASE64
        // --------------------------------------------------------

        const base64Image =
            `data:${finalContentType};base64,${Buffer
                .from(imageResponse.data)
                .toString("base64")}`

        // --------------------------------------------------------
        // UPLOAD TO IMAGEKIT MEDIA LIBRARY
        // --------------------------------------------------------

        console.log(
            "UPLOADING IMAGE TO IMAGEKIT MEDIA LIBRARY..."
        )

        const uploadResponse =
            await imagekit.upload({
                file: base64Image,
                fileName,
                folder: "quickgpt"
            })

        if (
            !uploadResponse ||
            !uploadResponse.url
        ) {
            throw new Error(
                "ImageKit upload failed. No image URL returned."
            )
        }

        console.log(
            "IMAGEKIT UPLOAD SUCCESS:",
            uploadResponse.url
        )

        // --------------------------------------------------------
        // SAVE USER MESSAGE
        // --------------------------------------------------------

        chat.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
            isImage: false
        })

        // --------------------------------------------------------
        // CREATE ASSISTANT REPLY
        // --------------------------------------------------------

        const reply = {
            role: "assistant",
            content: uploadResponse.url,
            timestamp: Date.now(),
            isImage: true,
            isPublished: Boolean(isPublished)
        }

        // --------------------------------------------------------
        // SAVE ASSISTANT MESSAGE
        // --------------------------------------------------------

        chat.messages.push(reply)

        await chat.save()

        // --------------------------------------------------------
        // DEDUCT CREDITS ONLY AFTER SUCCESS
        // --------------------------------------------------------

        await User.updateOne(
            { _id: userId },
            {
                $inc: {
                    credits: -2
                }
            }
        )

        console.log("=================================")
        console.log("IMAGE GENERATION SUCCESS")
        console.log("CREDITS DEDUCTED: 2")
        console.log("=================================")

        // --------------------------------------------------------
        // SEND FINAL RESPONSE
        // --------------------------------------------------------

        return res.json({
            success: true,
            reply
        })

    } catch (error) {

        console.error("=================================")
        console.error("IMAGE GENERATION ERROR")
        console.error("MESSAGE:", error.message)
        console.error("=================================")

        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
}

