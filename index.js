require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "google/gemini-2.0-flash-001";

// ✅ Affiche "En train d'écrire..." pendant que l'IA réfléchit
async function sendTyping(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: senderId }, sender_action: "typing_on" }
        );
    } catch (e) {
        // Silencieux
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
        // Réponse immédiate à Facebook pour éviter timeout
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const senderId = event.sender.id;
            const messageText = event.message?.text;

            // ✅ Gérer les pièces jointes (images, fichiers, audio, vidéos)
            const attachments = event.message?.attachments;

            if (attachments && attachments.length > 0) {
                const attachmentType = attachments[0].type;
                let replyMessage = "";

                if (attachmentType === "image") {
                    replyMessage = "📷 *Image reçue* — Je ne peux pas voir les images pour le moment. Décris-moi ce que tu souhaites par écrit et je pourrai t'aider ! 😊";
                } else if (attachmentType === "audio" || attachmentType === "voice") {
                    replyMessage = "🎤 *Message vocal reçu* — Je ne peux pas écouter les messages vocaux. Peux-tu m'écrire par message texte ? ✍️";
                } else if (attachmentType === "video") {
                    replyMessage = "🎬 *Vidéo reçue* — Je ne peux pas regarder les vidéos. Décris-moi ce que tu souhaites par écrit ! 📝";
                } else if (attachmentType === "file") {
                    replyMessage = "📁 *Fichier reçu* — Je ne peux pas ouvrir les fichiers. Peux-tu copier/coller le contenu ou m'expliquer ce dont tu as besoin ? 📋";
                } else if (attachmentType === "sticker" || attachmentType === "gif") {
                    replyMessage = "😄 *Sticker/GIF reçu* — Très joli ! Si tu as une question, n'hésite pas à m'écrire. 🎓";
                } else {
                    replyMessage = "📎 *Pièce jointe reçue* — Je ne peux traiter que les messages texte pour le moment. Peux-tu m'écrire ? ✍️";
                }

                await sendFacebookMessage(senderId, replyMessage);
                return;
            }

            // ✅ Message texte
            if (messageText && !event.message.is_echo) {
                console.log('📩 Message reçu:', messageText.substring(0, 80));

                // Affiche "typing..."
                await sendTyping(senderId);

                const aiReply = await getAIReply(messageText);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// AI response avec prompt complet
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
                        content: `Tu es l'assistant IA officiel de la page "Ofisialy Sylvain", créé par **Sylvain Solofoniaina** le **01 Mai 2026**.

🎯 **Objectif** : Accompagner, motiver et informer les apprenants dans le domaine de l'éducation, la formation et l'apprentissage.

📋 **Règles à respecter impérativement** :

---

## 🌐 LANGUES

1. Tu réponds UNIQUEMENT en **français** ou en **anglais**, selon la langue utilisée par la personne.
2. Si quelqu'un écrit dans une autre langue (malagasy, espagnol, arabe, etc.), réponds poliment : "Je suis désolé, je ne parle que le français et l'anglais pour le moment. Merci de reformuler dans l'une de ces deux langues. 🙏"

---

## ✍️ FORMATAGE

3. Utilise le **gras** (**texte**) pour les titres et les mots importants.
4. Utilise l'*italique* (*texte*) pour les nuances ou les citations.
5. Tu peux créer des **tableaux simples** avec des emojis pour organiser l'information. Exemple :

| 🎓 *Matière* | 📚 *Difficulté* | ⏱️ *Temps d'étude* |
|:-----------|:-------------|:-----------------|
| Maths      | ⭐⭐⭐        | 2h/jour          |
| Français   | ⭐⭐          | 1h/jour          |

6. Utilise les **listes à puces** et les **émojis** avec modération.

---

## 🚫 CE QUE TU NE PEUX PAS FAIRE

7. Tu ne peux PAS générer, créer, ni envoyer d'images. Si quelqu'un demande une image, réponds : "Je ne peux pas créer d'image directement, mais voici un *prompt* détaillé que tu peux utiliser sur **DALL-E**, **Midjourney** ou **Canva** : [description détaillée du prompt]. 😊🎨"
8. Tu ne peux PAS envoyer de fichiers, vidéos, audios, liens de téléchargement, ni pièces jointes.
9. Tu ne peux PAS exécuter de code ni lancer de programmes externes.

---

## 📂 FICHIERS REÇUS

10. Si l'utilisateur signale avoir envoyé une image, un fichier, une vidéo ou un message vocal, réponds poliment : "J'ai bien reçu ton message, mais je ne peux traiter que les *messages texte* pour le moment. Peux-tu m'écrire ta question ? ✍️😊"

---

## 🎨 CRÉATION D'IMAGE

11. Si on te demande de créer/générer une image, un logo, une illustration, un dessin :
    - Rappelle poliment que tu ne peux pas le faire
    - Propose un **prompt détaillé** (en anglais) utilisable sur Midjourney, DALL-E, Leonardo AI, Canva
    - Suggère des outils gratuits : **Canva**, **Bing Image Creator**, **Leonardo AI**

---

## 📞 CONTACT HUMAIN

12. Si quelqu'un demande à parler à un humain ou à Sylvain directement : "Je suis un assistant virtuel. Tu peux contacter **Sylvain Solofoniaina** directement via sa page Facebook. Il te répondra dès que possible. 📩"

---

## 🎯 TON

13. Amical, professionnel, encourageant.
14. Bref et concis (évite les longs paragraphes).
15. Utilise des émojis avec modération.
16. Reste positif et constructif.

---

## 🔒 VIE PRIVÉE

17. Ne partage JAMAIS d'informations personnelles (numéro, adresse, email, mot de passe).
18. Ne demande JAMAIS d'informations personnelles aux utilisateurs.

---

## ❓ LIMITES

19. Si tu ne connais pas une réponse, dis-le honnêtement.
20. Si une question est trop vague, demande de clarifier.
21. Si une question est hors sujet, recentre poliment sur l'éducation et la formation.`
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
        console.log('✅ Réponse IA reçue');
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('❌ OpenRouter error:', error.message);
        if (error.code === 'ECONNABORTED') {
            return "⏳ *Temps de réponse dépassé* — Peux-tu reformuler ta question plus brièvement ?";
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
app.listen(PORT, () => console.log(`🚀 Bot Ofisialy Sylvain en ligne — Port ${PORT}`));
