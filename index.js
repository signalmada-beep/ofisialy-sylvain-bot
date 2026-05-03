require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ================= CONFIG =================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID || "1083011031566013";
const AI_MODEL = "openai/gpt-oss-120b:free";

// ========== API KEY ROTATION ==========
const API_KEYS = (process.env.OPENROUTER_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
let currentKeyIndex = 0;

function getApiKey() {
    if (API_KEYS.length === 0) return '';
    return API_KEYS[currentKeyIndex];
}

function getNextApiKey() {
    if (API_KEYS.length <= 1) return null;
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    console.log(`🔄 Switch API key → #${currentKeyIndex + 1}/${API_KEYS.length}`);
    return getApiKey();
}

function hasNextKey() {
    return currentKeyIndex < API_KEYS.length - 1;
}

// ========== ADMIN ==========
const ADMIN_IDS = ["61589117400590", "SylvainOfisialy"];

// ========== QUOTAS ==========
const userQuotas = {};
const TEST_MODE_LIMIT = 20;
const DAILY_LIMIT = 10;
const dailyReset = {};

function checkQuota(senderId) {
    const today = new Date().toDateString();
    if (dailyReset[senderId] !== today) {
        dailyReset[senderId] = today;
        if (userQuotas[senderId]?.mode === 'daily') userQuotas[senderId].count = 0;
    }
    if (!userQuotas[senderId]) {
        userQuotas[senderId] = { mode: 'test', count: 1 };
        return { allowed: true, mode: 'test', remaining: TEST_MODE_LIMIT - 1 };
    }
    const quota = userQuotas[senderId];
    if (quota.mode === 'test') {
        quota.count++;
        if (quota.count > TEST_MODE_LIMIT) {
            quota.mode = 'daily';
            quota.count = 1;
            return { allowed: true, mode: 'daily', remaining: DAILY_LIMIT - 1 };
        }
        return { allowed: true, mode: 'test', remaining: TEST_MODE_LIMIT - quota.count };
    }
    if (quota.mode === 'daily') {
        quota.count++;
        if (quota.count > DAILY_LIMIT) return { allowed: false, mode: 'daily', remaining: 0 };
        return { allowed: true, mode: 'daily', remaining: DAILY_LIMIT - quota.count };
    }
    return { allowed: false, remaining: 0 };
}

// ========== HISTORIQUE ==========
const conversationHistory = {};
const MAX_HISTORY = 10;
const lastActivity = {};

function addToHistory(senderId, role, content) {
    if (!conversationHistory[senderId]) conversationHistory[senderId] = [];
    conversationHistory[senderId].push({ role, content, timestamp: Date.now() });
    if (conversationHistory[senderId].length > MAX_HISTORY * 2) {
        conversationHistory[senderId] = conversationHistory[senderId].slice(-MAX_HISTORY * 2);
    }
    lastActivity[senderId] = Date.now();
}

function getHistory(senderId) {
    return conversationHistory[senderId] || [];
}

// ========== DETECT LANGUAGE ==========
function detectLanguage(text) {
    const normalized = text.toLowerCase().trim();
    const malagasyWords = ['manao', 'ahoana', 'misaotra', 'azafady', 'ianao', 'mbola', 'tsara', 'mety', 'aho', 'anao', 'ny', 'ary', 'fa', 'koa', 've', 'inona', 'mba'];
    const frenchWords = ['bonjour', 'salut', 'merci', 'bonsoir', 'comment', 'pourquoi', 'quand', 'je', 'vous', 'nous', 'bonne', 'jour', 'oui', 'non', 'est', 'une', 'les', 'des', 'grammaire', 'conjugaison', 'exercice', 'français', 'aide'];
    const englishWords = ['hello', 'hi', 'thanks', 'thank', 'good', 'morning', 'how', 'what', 'when', 'where', 'why', 'please', 'sorry', 'help', 'the', 'is', 'are', 'grammar', 'english', 'quiz'];
    const arabicPattern = /[\u0600-\u06FF]/;
    const chinesePattern = /[\u4E00-\u9FFF]/;
    const russianPattern = /[\u0400-\u04FF]/;
    const japanesePattern = /[\u3040-\u30FF]/;
    const koreanPattern = /[\uAC00-\uD7AF]/;

    if (arabicPattern.test(text)) return 'arabic';
    if (chinesePattern.test(text)) return 'chinese';
    if (russianPattern.test(text)) return 'russian';
    if (japanesePattern.test(text)) return 'japanese';
    if (koreanPattern.test(text)) return 'korean';

    let mg = 0, fr = 0, en = 0;
    const words = normalized.split(/\s+/);
    for (const word of words) {
        if (malagasyWords.some(w => word.includes(w))) mg++;
        if (frenchWords.some(w => word.includes(w))) fr++;
        if (englishWords.some(w => word.includes(w))) en++;
    }
    if (fr > en && fr > mg) return 'french';
    if (en > fr && en > mg) return 'english';
    if (mg > fr && mg > en) return 'malagasy';
    if (fr >= 1) return 'french';
    if (en >= 1) return 'english';
    return 'unknown';
}

// ========== STATS ==========
const adminStats = {
    totalMessages: 0,
    totalUsers: new Set(),
    commentsReplied: 0,
    followRequests: 0,
    languagesDetected: {},
    startTime: Date.now()
};

// ========== FUNCTIONS ==========
async function sendTyping(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: senderId }, sender_action: "typing_on" }
        );
    } catch (e) {}
}

async function replyToComment(commentId, message) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/comments`,
            { message, access_token: PAGE_ACCESS_TOKEN }
        );
        console.log('✅ Comment replied:', response.data?.id);
    } catch (error) {
        console.error('❌ Reply error DETAILS:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
    }
}
async function sendFacebookMessage(recipientId, text) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: recipientId }, message: { text } }
        );
        console.log('✅ Sent:', response.data?.message_id);
    } catch (error) {
        console.error('❌ Send error DETAILS:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
    }
}

// ========== AI REPLY ==========
async function getAIReply(userMessage, senderId) {
    const history = getHistory(senderId);
    const systemPrompt = `Vous êtes l'assistant IA officiel de la page "Ofisialy Sylvain", créée par Sylvain Solofoniaina le 01 Mai 2026.

🎯 RÔLE : Assistant pédagogique expert en FRANÇAIS et ANGLAIS.
🌐 LANGUES : Répondez dans LA MÊME LANGUE que l'utilisateur.
⚠️ SI PAS FR/EN : Saluez dans sa langue, expliquez que vos compétences sont FR/EN uniquement.
📋 FORMATAGE : PAS de Markdown. MAJUSCULES pour les titres. Émojis modérés. Réponses courtes.
📢 À la fin : Ajoutez UNE phrase d'encouragement à suivre/liker/partager.
🚫 LIMITES : Pas d'images, fichiers, vidéos, audio.`;

    for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
        const currentKey = getApiKey();
        if (!currentKey) break;
        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                { model: AI_MODEL, max_tokens: 500, temperature: 0.6, messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-8), { role: 'user', content: userMessage }] },
                { headers: { 'Authorization': `Bearer ${currentKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://ofisialysylvain.com', 'X-Title': 'Ofisialy Sylvain Bot' }, timeout: 30000 }
            );
            console.log('✅ AI Reply');
            return response.data.choices[0].message.content;
        } catch (error) {
            console.warn(`⚠️ Erreur clé #${currentKeyIndex + 1}`);
            if (error.response?.status === 402 || error.response?.status === 429) {
                if (hasNextKey()) { getNextApiKey(); continue; }
            }
            break;
        }
    }
    return "🔧 Service momentanément indisponible. Merci de réessayer. 🙏";
}

// ========== WEBHOOK GET ==========
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

// ========== WEBHOOK POST (MITAMBATRA) ==========
app.post('/webhook', async (req, res) => {
    const body = req.body;

    // Réponse rapide obligatoire
    res.status(200).send('EVENT_RECEIVED');

   if (body.object !== 'page') {
    console.log('⚠️ Not a page event, ignoring');
    return;
}
console.log('📨 FULL BODY KEYS:', Object.keys(body));
console.log('📨 ENTRY KEYS:', Object.keys(body.entry[0] || {}));

    for (const entry of body.entry) {

        // ================= COMMENTS (CHANGES) =================
        console.log('📨 ENTRY:', JSON.stringify(entry).substring(0, 500));
        if (entry.changes) {
            for (const change of entry.changes) {
                console.log('📦 CHANGE FULL:', JSON.stringify(change, null, 2));

                // ===== PAGE COMMENTS =====
                if (change.field === 'feed' && change.value?.item === 'comment') {
                    const commentId = change.value.comment_id;
                    const senderId = change.value.from?.id;
                    const senderName = change.value.from?.name || '';
                    const message = change.value.message || '';

                    if (!commentId || !senderId) continue;
                    if (ADMIN_IDS.includes(senderId) || senderId === PAGE_ID) {
                        console.log('⏭️ Ignored admin/self');
                        continue;
                    }

                    console.log(`💬 PAGE COMMENT: ${senderName} → ${message}`);
                    adminStats.commentsReplied++;

                    try {
                        const reply = `Merci ${senderName} pour votre commentaire ! 🙌\n\nDécouvrez notre assistant gratuit ici 👉 m.me/OfisialySylvain`;
                        await replyToComment(commentId, reply);
                    } catch (err) {
                        console.error('❌ Error comment:', err.message);
                    }
                }

                // ===== GROUP COMMENTS =====
                if (change.field === 'group_feed' && change.value?.item === 'comment') {
                    const commentId = change.value.comment_id;
                    const senderId = change.value.from?.id;
                    const senderName = change.value.from?.name || '';
                    const message = change.value.message || '';

                    if (!commentId || !senderId) continue;

                    console.log(`👥 GROUP COMMENT: ${senderName} → ${message}`);
                    adminStats.commentsReplied++;

                    try {
                        await replyToComment(commentId, `Merci ${senderName} pour votre participation ! 🎓\n\nRejoignez-nous aussi sur Messenger 👉 m.me/OfisialySylvain`);
                    } catch (err) {
                        console.error('❌ Error group:', err.message);
                    }
                }
            }
        }

        // ================= MESSENGER =================
        if (entry.messaging) {
            for (const event of entry.messaging) {
                const senderId = event.sender?.id;
                const text = event.message?.text;
                const attachments = event.message?.attachments;

                if (!senderId) continue;

                adminStats.totalMessages++;
                adminStats.totalUsers.add(senderId);

                // Pièces jointes
                if (attachments?.length > 0) {
                    const type = attachments[0].type;
                    const replies = {
                        image: "📷 Image reçue — Je ne peux pas voir les images. Décris-moi par écrit ! 😊",
                        audio: "🎤 Vocal reçu — Je ne peux pas l'écouter. Écris-moi ! ✍️",
                        video: "🎬 Vidéo reçue — Je ne peux pas la regarder. Décris-moi ! 📝",
                        file: "📁 Fichier reçu — Je ne peux pas l'ouvrir. Copie-colle le contenu ! 📋",
                        sticker: "😄 Joli ! Une question ? Écris-moi. 🎓",
                    };
                    await sendFacebookMessage(senderId, replies[type] || replies.file);
                    continue;
                }

                if (!text || event.message?.is_echo) continue;

                const textLower = text.toLowerCase();
                console.log(`📩 MSG [${senderId.slice(-4)}]: ${text.substring(0, 60)}`);

                // Commande ADMIN
                if (ADMIN_IDS.includes(senderId) && textLower.startsWith('admin')) {
                    const uptime = Math.floor((Date.now() - adminStats.startTime) / 60000);
                    const statsMsg = `📊 STATS ADMIN\n\n👥 Users: ${adminStats.totalUsers.size}\n💬 Messages: ${adminStats.totalMessages}\n💬 Comments: ${adminStats.commentsReplied}\n📢 Follows: ${adminStats.followRequests}\n⏱️ Uptime: ${uptime} min\n\n🌐 Langues:\n${Object.entries(adminStats.languagesDetected).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
                    await sendFacebookMessage(senderId, statsMsg);
                    continue;
                }

                // Première interaction
                if (!conversationHistory[senderId] || conversationHistory[senderId].length === 0) {
                    const welcomeMsg = `🎉 *Bienvenue sur Ofisialy Sylvain !*\n\n📌 *Abonnez-vous* pour recevoir nos conseils gratuits chaque jour.\n👍 *Likez, commentez, partagez* — votre soutien compte ! 🚀\n\nPosez votre question en Français ou en Anglais !`;
                    await sendFacebookMessage(senderId, welcomeMsg);
                    adminStats.followRequests++;
                    addToHistory(senderId, 'assistant', welcomeMsg);
                }

                // Quota
                const quota = checkQuota(senderId);
                if (!quota.allowed) {
                    await sendFacebookMessage(senderId, `⚠️ Limite quotidienne atteinte (${DAILY_LIMIT} messages/jour).\n\n🔄 Revenez demain !\n📌 Abonnez-vous à la page. 😊`);
                    continue;
                }

                // AI Reply
                await sendTyping(senderId);
                addToHistory(senderId, 'user', text);
                const aiReply = await getAIReply(text, senderId);
                addToHistory(senderId, 'assistant', aiReply);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
    }
});

// ========== START ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Ofisialy Sylvain Bot — Port ${PORT}`));
