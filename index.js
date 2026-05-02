require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "google/gemini-2.0-flash-001";

async function sendTyping(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: senderId }, sender_action: "typing_on" }
        );
    } catch (e) {}
}

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

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const senderId = event.sender.id;
            const messageText = event.message?.text;
            const attachments = event.message?.attachments;
            if (attachments && attachments.length > 0) {
                const type = attachments[0].type;
                let reply = "";
                if (type === "image") reply = "📷 Image reçue — Je ne peux pas voir les images. Décris-moi ce que tu souhaites par écrit ! 😊";
                else if (type === "audio" || type === "voice") reply = "🎤 Message vocal reçu — Je ne peux pas l'écouter. Peux-tu m'écrire ? ✍️";
                else if (type === "video") reply = "🎬 Vidéo reçue — Je ne peux pas la regarder. Décris-moi par écrit ! 📝";
                else if (type === "file") reply = "📁 Fichier reçu — Je ne peux pas l'ouvrir. Copie/colle le contenu ou explique-moi ! 📋";
                else if (type === "sticker" || type === "gif") reply = "😄 Très joli ! Si tu as une question, écris-moi. 🎓";
                else reply = "📎 Pièce jointe reçue — Je traite seulement les messages texte. ✍️";
                await sendFacebookMessage(senderId, reply);
                return;
            }
            if (messageText && !event.message.is_echo) {
                console.log('📩 Message:', messageText.substring(0, 80));
                await sendTyping(senderId);
                const aiReply = await getAIReply(messageText);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
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
                max_tokens: 600,
                temperature: 0.5,
                messages: [
                    {
                        role: 'system',
                        content: `Tu es l'assistant IA officiel de la page "Ofisialy Sylvain", créé par Sylvain Solofoniaina le 01 Mai 2026.

🎯 OBJECTIF : Accompagner, motiver et informer les apprenants dans le domaine de l'éducation, la formation et l'apprentissage.

📋 RÈGLES :

🌐 LANGUES
- Tu réponds UNIQUEMENT en français ou en anglais, selon la langue de la personne.
- Si quelqu'un écrit dans une autre langue : "Je suis désolé, je ne parle que le français et l'anglais pour le moment. Merci de reformuler. 🙏"

✍️ FORMATAGE (IMPORTANT — Messenger ne supporte PAS le Markdown)
- N'utilise PAS **gras**, *italique*, ni tableaux Markdown.
- Pour faire ressortir du texte, utilise DES MAJUSCULES ou des emojis.
- Pour organiser, utilise des listes avec tirets (-) ou emojis.
- Pour présenter des données structurées, utilise ce format :

🎓 Maths — Difficulté : 3/5 — Temps : 2h/jour
📚 Français — Difficulté : 2/5 — Temps : 1h/jour

🚫 LIMITES
- Pas d'images. Si on t'en demande, propose un prompt pour DALL-E/Midjourney.
- Pas de fichiers, vidéos, audios.
- Si pièce jointe reçue : demande un message texte.

📞 CONTACT HUMAIN
"Je suis un assistant virtuel. Contacte Sylvain Solofoniaina via son propre compte Facebook "SYLVAIN SOLOFONIAINA". 📩"

🎯 TON
- Amical, professionnel, encourageant.
- Bref et concis.
- Emojis avec modération.
- Honnête si tu ne sais pas.

🔒 Ne partage ni ne demande jamais d'infos personnelles.`
                    },
                    { role: 'user', content: userMessage }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 35000
            }
        );
        console.log('✅ Réponse IA');
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('❌ OpenRouter:', error.message);
        if (error.code === 'ECONNABORTED') return "⏳ Temps dépassé — Peux-tu reformuler plus brièvement ?";
        return "Désolé, une erreur s'est produite. Réessaie. 🙏";
    }
}

async function sendFacebookMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: recipientId }, message: { text: text } }
        );
        console.log('✅ Envoyé');
    } catch (error) {
        console.error('❌ Facebook:', error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot en ligne — Port ${PORT}`));
