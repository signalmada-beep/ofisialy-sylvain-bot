require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "google/gemini-2.0-flash-001"; // Modèle rapide et gratuit

// ✅ Réponse immédiate pendant que l'IA réfléchit
async function sendQuickReply(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                recipient: { id: senderId },
                sender_action: "typing_on" // Affiche "En train d'écrire..."
            }
        );
    } catch (e) {
        // Silencieux si erreur
    }
}

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
        // Répondre à Facebook IMMÉDIATEMENT pour éviter timeout
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const senderId = event.sender.id;
            const messageText = event.message?.text;
            if (messageText && !event.message.is_echo) {
                console.log('📩 Message reçu:', messageText.substring(0, 50));
                
                // Affiche "typing..." pendant que l'IA réfléchit
                await sendQuickReply(senderId);
                
                const aiReply = await getAIReply(messageText);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// AI response — OPTIMISÉE (max_tokens réduit, temperature basse)
async function getAIReply(userMessage) {
    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: AI_MODEL,
                max_tokens: 500, // Réponse plus courte = plus rapide
                temperature: 0.5, // Plus cohérent, moins aléatoire
                messages: [
                    {
                        role: 'system',
                        content: `Tu es l'assistant IA officiel de la page "Ofisialy Sylvain", créé par **Sylvain Solofoniaina** le **01 Mai 2026**.

🎯 **Objectif** : Accompagner, motiver et informer les apprenants dans le domaine de l'éducation, la formation et l'apprentissage.

📋 **Règles à respecter impérativement** :

1. **Langues autorisées** : Tu réponds UNIQUEMENT en **français** ou en **anglais**, selon la langue utilisée par la personne. Si quelqu'un écrit dans une autre langue, réponds poliment : "Je suis désolé, je ne parle que le français et l'anglais pour le moment. Merci de reformuler dans l'une de ces deux langues. 🙏"

2. **Formatage** : Tu peux utiliser le **gras** (**texte**), l'*italique* (*texte*), et les emojis 🎓📚✨ avec modération. Tu ne peux PAS envoyer d'images.

3. **Création d'image** : Si quelqu'un demande une image, réponds que tu ne peux pas générer d'image, mais donne un prompt détaillé utilisable sur DALL-E ou Midjourney. Exemple : "Je ne peux pas créer d'image directement, mais voici un prompt que tu peux utiliser : [description détaillée]. 😊"

4. **Ton** : Amical, professionnel, encourageant. Sois bref et concis.

5. **Vie privée** : Ne partage jamais d'informations personnelles.

6. **Contact humain** : Si quelqu'un veut parler à un humain : "Je suis un assistant virtuel. Contacte directement la page Facebook, Sylvain te répondra. 📩"

7. **Limites** : Si tu ne sais pas, dis-le honnêtement.`
                    },
                    { role: 'user', content: userMessage }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 35000 // Timeout 35 secondes max
            }
        );
        console.log('✅ Réponse IA reçue');
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('❌ OpenRouter error:', error.message);
        if (error.code === 'ECONNABORTED') {
            return "⏳ Désolé, la réponse a pris trop de temps. Peux-tu reformuler ta question plus brièvement ?";
        }
        return "Désolé, une erreur s'est produite. Réessaie dans quelques instants. 🙏";
    }
}

// Send to Facebook
async function sendFacebookMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: recipientId }, message: { text: text } }
        );
        console.log('✅ Message envoyé');
    } catch (error) {
        console.error('❌ Facebook send error:', error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot Ofisialy Sylvain en ligne sur le port ${PORT}`));
