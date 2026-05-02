require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "mistralai/mistral-7b-instruct:free";

// Webhook verification GET
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// Receive messages POST
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const senderId = event.sender.id;
            const messageText = event.message?.text;
            if (messageText && !event.message.is_echo) {
                const aiReply = await getAIReply(messageText);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

async function getAIReply(userMessage) {
    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: AI_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: "Tu es l'assistant officiel de 'Ofisialy Sylvain', une page dédiée à la formation et à l'enseignement. Tu réponds en français ou en anglais selon la langue de la personne. Ton ton est amical, bienveillant et motivant. Tu utilises des emojis avec modération."
                    },
                    { role: 'user', content: userMessage }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('OpenRouter error:', error.message);
        return "Désolé, une erreur s'est produite. Réessaie plus tard. 🙏";
    }
}

async function sendFacebookMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: recipientId }, message: { text: text } }
        );
    } catch (error) {
        console.error('Facebook send error:', error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot running on port ${PORT}`));
