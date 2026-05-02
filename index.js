require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID || "1083011031566013";
const AI_MODEL = "openai/gpt-oss-120b:free";

// ========== API KEY ROTATION ==========
const API_KEYS = (process.env.OPENROUTER_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
let currentKeyIndex = 0;

function getApiKey() {
    if (API_KEYS.length === 0) {
        console.error('❌ Aucune clé API trouvée !');
        return '';
    }
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

// ========== RATE LIMITING POUR GROUPES ==========
const groupCommentQueue = {};
const groupLastReply = {};
const GROUP_BATCH_SIZE = 3;
const GROUP_COOLDOWN = 10 * 60 * 1000;
const GROUP_REPLY_DELAY = 5000;

async function processGroupQueue(groupId) {
    if (!groupCommentQueue[groupId] || groupCommentQueue[groupId].length === 0) return;

    const now = Date.now();
    const lastReply = groupLastReply[groupId] || 0;

    if (now - lastReply < GROUP_COOLDOWN) {
        console.log(`⏳ Groupe ${groupId} en cooldown — ${Math.ceil((GROUP_COOLDOWN - (now - lastReply)) / 60000)} min restantes`);
        return;
    }

    console.log(`📤 Traitement queue groupe ${groupId}: ${groupCommentQueue[groupId].length} en attente`);

    const batch = groupCommentQueue[groupId].splice(0, GROUP_BATCH_SIZE);

    for (let i = 0; i < batch.length; i++) {
        const item = batch[i];

        if (ADMIN_IDS.includes(item.senderId)) continue;
        if (now - item.timestamp > 30 * 60 * 1000) continue;

        console.log(`💬 [GROUPE ${groupId}] Réponse à ${item.senderName}: "${item.message?.substring(0, 40)}"`);

        const reply = await generateGroupCommentReply(item.message, item.senderName, groupId);
        await replyToGroupComment(groupId, item.commentId, reply);
        adminStats.commentsReplied++;

        if (i < batch.length - 1) {
            await new Promise(resolve => setTimeout(resolve, GROUP_REPLY_DELAY));
        }
    }

    groupLastReply[groupId] = Date.now();

    if (groupCommentQueue[groupId].length > 0) {
        console.log(`📋 Reste ${groupCommentQueue[groupId].length} en attente pour groupe ${groupId}`);
        setTimeout(() => processGroupQueue(groupId), GROUP_COOLDOWN);
    }
}

// ========== QUOTAS ==========
const userQuotas = {};
const TEST_MODE_LIMIT = 20;
const DAILY_LIMIT = 10;
const dailyReset = {};

function checkQuota(senderId) {
    const today = new Date().toDateString();
    if (dailyReset[senderId] !== today) {
        dailyReset[senderId] = today;
        if (userQuotas[senderId]?.mode === 'daily') {
            userQuotas[senderId].count = 0;
        }
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
    return { allowed: false, mode: 'unknown', remaining: 0 };
}

// ========== HISTORIQUE CONVERSATION ==========
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

function getLastActivity(senderId) {
    return lastActivity[senderId] || Date.now();
}

// ========== INACTIVITY CHECKER (30 min) ==========
const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

function checkInactivity(senderId) {
    const last = getLastActivity(senderId);
    const now = Date.now();
    return (now - last) >= INACTIVITY_TIMEOUT;
}

// ========== INVITATION MESSAGES ==========
function getFollowMessage(lang, type) {
    const messages = {
        'welcome': {
            fr: `🎉 *Bienvenue sur Ofisialy Sylvain !*\n\nNous sommes ravis de vous accueillir ! 😊\n\n📌 *Abonnez-vous à la page* pour recevoir nos conseils et exercices gratuits chaque jour.\n\n👍 *Likez, commentez, partagez* — votre soutien nous aide à aider plus d'apprenants !\n\n🚀 Commençons ! Que puis-je faire pour vous ?`,
            en: `🎉 *Welcome to Ofisialy Sylvain!*\n\nWe're happy to have you here! 😊\n\n📌 *Follow our page* for daily free tips and exercises.\n\n👍 *Like, comment, share* — your support helps us reach more learners!\n\n🚀 Let's start! How can I help you?`,
            other: `🎉 *Welcome / Bienvenue !*\n\n📌 *Follow / Abonnez-vous* à Ofisialy Sylvain pour apprendre le Français et l'Anglais !\n\n👍 *Like, comment, share / Likez, commentez, partagez* — votre soutien compte ! 🚀`
        },
        'reminder': {
            fr: `📌 *Rappel amical !*\n\nCela fait un moment que nous n'avons pas échangé. 😊\n\nSi notre page vous plaît :\n👍 *Likez* pour nous soutenir\n💬 *Commentez* pour donner votre avis\n🔄 *Partagez* avec 3 amis qui apprennent le Français ou l'Anglais\n📌 *Abonnez-vous* pour ne rien manquer\n\n🚀 Revenez quand vous voulez — nous sommes là 24h/24 !`,
            en: `📌 *Friendly reminder!*\n\nIt's been a while since we last chatted. 😊\n\nIf you like our page:\n👍 *Like* to support us\n💬 *Comment* to share your thoughts\n🔄 *Share* with 3 friends learning French or English\n📌 *Follow* to stay updated\n\n🚀 Come back anytime — we're here 24/7!`,
            other: `📌 *Reminder / Rappel !*\n\n📌 *Follow / Abonnez-vous* | 👍 *Like / Likez* | 🔄 *Share / Partagez* | 💬 *Comment / Commentez*\n\n🚀 Come back / Revenez bientôt !`
        }
    };
    const langKey = (lang === 'french') ? 'fr' : (lang === 'english') ? 'en' : 'other';
    return messages[type]?.[langKey] || messages[type]?.['other'] || '';
}

// ========== QUIZ SYSTEM ==========
const quizSessions = {};

const quizFR = [
    { question: "❓ Conjuguez le verbe ALLER au présent, 1ère personne du singulier :", answer: ["je vais"], hint: "Je ___ au marché." },
    { question: "❓ Quel est le féminin de BEAU ?", answer: ["belle"], hint: "Une ___ fleur." },
    { question: "❓ Complétez : 'Il faut que tu ___ (venir) ici.'", answer: ["viennes"], hint: "Subjonctif présent." },
    { question: "❓ Quel est le contraire de RAPIDE ?", answer: ["lent", "lente"], hint: "Une tortue est très ___." },
    { question: "❓ Accordez : 'Les fleurs que j'ai ___ (cueillir) sont belles.'", answer: ["cueillies"], hint: "Accord du participe passé avec COD avant." },
    { question: "❓ Quelle est la bonne orthographe : 'il a mangé' ou 'il a manger' ?", answer: ["il a mangé"], hint: "Participe passé avec avoir." },
    { question: "❓ Pluriel de OEIL ?", answer: ["yeux"], hint: "Pluriel irrégulier." },
    { question: "❓ Donnez un synonyme de COURAGEUX.", answer: ["brave", "vaillant", "intrépide", "audacieux"], hint: "Quelqu'un qui n'a pas peur." },
];

const quizEN = [
    { question: "❓ What is the past tense of GO?", answer: ["went"], hint: "I ___ to school yesterday." },
    { question: "❓ Use the correct form: 'She ___ (be) tired.'", answer: ["is"], hint: "Present simple, 3rd person." },
    { question: "❓ What is the opposite of BEAUTIFUL?", answer: ["ugly"], hint: "Not pretty." },
    { question: "❓ Complete: 'If I ___ rich, I would travel.'", answer: ["were", "was"], hint: "Second conditional." },
    { question: "❓ Give a synonym of HAPPY.", answer: ["joyful", "glad", "pleased", "content", "cheerful"], hint: "Feeling great!" },
    { question: "❓ Plural of CHILD?", answer: ["children"], hint: "Irregular plural." },
    { question: "❓ Which is correct: 'I have went' or 'I have gone'?", answer: ["i have gone"], hint: "Past participle of GO." },
    { question: "❓ What does BENEVOLENT mean?", answer: ["kind", "generous", "good", "charitable", "well-meaning"], hint: "A ___ person helps others." },
];

function startQuiz(senderId, lang) {
    const questions = lang === 'fr' ? quizFR : quizEN;
    const idx = Math.floor(Math.random() * questions.length);
    quizSessions[senderId] = { lang, questionIdx: idx, attempts: 0, startTime: Date.now() };
    const q = questions[idx];
    return lang === 'fr'
        ? `🎮 QUIZ FRANÇAIS\n\n${q.question}\n\n💡 Indice : ${q.hint}\n\n✍️ Écrivez votre réponse !`
        : `🎮 ENGLISH QUIZ\n\n${q.question}\n\n💡 Hint: ${q.hint}\n\nWrite your answer!`;
}

function checkQuizAnswer(senderId, userAnswer) {
    const session = quizSessions[senderId];
    if (!session) return null;
    const questions = session.lang === 'fr' ? quizFR : quizEN;
    const q = questions[session.questionIdx];
    session.attempts++;
    const normalized = userAnswer.toLowerCase().trim();
    const correct = q.answer.some(a => normalized.includes(a.toLowerCase()));
    if (correct) {
        delete quizSessions[senderId];
        const stars = session.attempts === 1 ? "⭐⭐⭐" : session.attempts === 2 ? "⭐⭐" : "⭐";
        return session.lang === 'fr'
            ? `✅ BRAVO ! Bonne réponse ! ${stars}\n\nLa réponse était : "${q.answer[0]}"\n\n🔄 Tapez QUIZ FRANÇAIS pour un autre ou QUIZ ANGLAIS pour changer !\n\n📌 Suivez notre page pour plus de quiz ! 👍`
            : `✅ CORRECT! Well done! ${stars}\n\nThe answer was: "${q.answer[0]}"\n\n🔄 Type QUIZ ENGLISH for another or QUIZ FRANÇAIS to switch!\n\n📌 Follow our page for more quizzes! 👍`;
    } else if (session.attempts >= 2) {
        delete quizSessions[senderId];
        return session.lang === 'fr'
            ? `❌ Pas tout à fait...\n\n✅ La bonne réponse était : "${q.answer[0]}"\n\n💪 Ne vous découragez pas ! Tapez QUIZ FRANÇAIS pour réessayer !\n\n📌 Suivez-nous pour continuer à apprendre ! 😊`
            : `❌ Not quite...\n\n✅ The correct answer was: "${q.answer[0]}"\n\n💪 Don't give up! Type QUIZ ENGLISH to try again!\n\n📌 Follow us to keep learning! 😊`;
    } else {
        return session.lang === 'fr'
            ? `🤔 Pas tout à fait... Essayez encore !\n\n💡 Indice : ${q.hint}`
            : `🤔 Not quite... Try again!\n\n💡 Hint: ${q.hint}`;
    }
}

// ========== EXERCICES PRATIQUE ==========
const exercicesFR = [
    "✍️ EXERCICE DU JOUR - FRANÇAIS\n\nRéécrivez cette phrase au passé composé :\n'Je mange une pomme.'\n\n📝 Écrivez votre réponse !",
    "✍️ EXERCICE DU JOUR - FRANÇAIS\n\nTrouvez 3 adjectifs pour décrire une ville moderne.\n\n📝 Écrivez votre réponse !",
    "✍️ EXERCICE DU JOUR - FRANÇAIS\n\nFaites une phrase avec le mot 'NÉANMOINS'.\n\n📝 Écrivez votre réponse !",
    "✍️ EXERCICE DU JOUR - FRANÇAIS\n\nCorrigez cette phrase : 'Les enfants a joué au parc.'\n\n📝 Écrivez votre réponse !",
];

const exercicesEN = [
    "✍️ DAILY EXERCISE - ENGLISH\n\nRewrite in passive voice:\n'The teacher explains the lesson.'\n\nWrite your answer!",
    "✍️ DAILY EXERCISE - ENGLISH\n\nFind 3 adjectives to describe a modern city.\n\nWrite your answer!",
    "✍️ DAILY EXERCISE - ENGLISH\n\nMake a sentence using 'HOWEVER'.\n\nWrite your answer!",
    "✍️ DAILY EXERCISE - ENGLISH\n\nCorrect this sentence: 'She don't like coffee.'\n\nWrite your answer!",
];

// ========== STATISTIQUES ADMIN ==========
const adminStats = {
    totalMessages: 0,
    totalUsers: new Set(),
    quizStarted: 0,
    quizCompleted: 0,
    languagesDetected: {},
    followRequests: 0,
    commentsReplied: 0,
    startTime: Date.now()
};

const ADMIN_IDS = ["SylvainOfisialy", "61589117400590"];

// ========== DETECT LANGUAGE ==========
function detectLanguage(text) {
    const normalized = text.toLowerCase().trim();
    const malagasyWords = ['manao', 'ahoana', 'misaotra', 'azafady', 'ianao', 'mbola', 'tsara', 'mety', 'aho', 'anao', 'ny', 'ary', 'fa', 'koa', 've', 'inona', 'mba'];
    const frenchWords = ['bonjour', 'salut', 'merci', 'bonsoir', 'comment', 'pourquoi', 'quand', 'je', 'vous', 'nous', 'notre', 'votre', 'bonne', 'jour', 'oui', 'non', 'est', 'une', 'les', 'des', 'grammaire', 'conjugaison', 'exercice', 'corrige', 'résumé', 'anglais', 'français', 'aide'];
    const englishWords = ['hello', 'hi', 'thanks', 'thank', 'good', 'morning', 'how', 'what', 'when', 'where', 'why', 'who', 'please', 'sorry', 'help', 'the', 'and', 'is', 'are', 'was', 'grammar', 'conjugation', 'exercise', 'correct', 'summary', 'english', 'french', 'quiz'];
    const spanishWords = ['hola', 'gracias', 'buenos', 'como', 'que', 'cuando', 'donde', 'por', 'para', 'quien', 'soy', 'eres', 'tengo'];
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

    let mg = 0, fr = 0, en = 0, es = 0;
    const words = normalized.split(/\s+/);
    for (const word of words) {
        if (malagasyWords.some(w => word.includes(w))) mg++;
        if (frenchWords.some(w => word.includes(w))) fr++;
        if (englishWords.some(w => word.includes(w))) en++;
        if (spanishWords.some(w => word.includes(w))) es++;
    }
    if (es >= 2) return 'spanish';
    if (mg >= 2) return 'malagasy';
    if (fr > en && fr > mg) return 'french';
    if (en > fr && en > mg) return 'english';
    if (mg > fr && mg > en) return 'malagasy';
    if (fr >= 1) return 'french';
    if (en >= 1) return 'english';
    if (mg >= 1) return 'malagasy';
    return 'unknown';
}

// ========== MENU PRINCIPAL ==========
function getMainMenu(lang) {
    if (lang === 'fr' || lang === 'french') {
        return `👋 Bienvenue sur Ofisialy Sylvain ! 🎓

📚 APPRENTISSAGE FRANÇAIS & ANGLAIS
- QUIZ FRANÇAIS / QUIZ ENGLISH
- EXERCICE FRANÇAIS / EXERCISE ENGLISH
- CONJUGUE [verbe] / CONJUGATE [verb]
- Posez vos questions de grammaire

📖 CORRECTIONS & OUTILS
- CORRIGE [texte] / CORRECT [text]
- RÉSUMÉ [texte] / SUMMARIZE [text]
- Aide rédaction (CV, lettre, email)

🌐 NOUS RÉPONDONS DANS TOUTES LES LANGUES

📊 AUTRES
- STATS / AIDE / ADMIN

🚀 Que puis-je faire pour vous ?`;
    }
    return `👋 Welcome to Ofisialy Sylvain! 🎓

📚 FRENCH & ENGLISH LEARNING
- QUIZ FRANÇAIS / QUIZ ENGLISH
- EXERCICE FRANÇAIS / EXERCISE ENGLISH
- CONJUGUE [verb] / CONJUGATE [verb]
- Ask your grammar questions

📖 CORRECTIONS & TOOLS
- CORRIGE [text] / CORRECT [text]
- RÉSUMÉ [text] / SUMMARIZE [text]
- Writing help (CV, letter, email)

🌐 WE REPLY IN ALL LANGUAGES

📊 OTHER
- STATS / HELP / ADMIN

🚀 How can I help you?`;
}

// ========== TYPING ==========
async function sendTyping(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: senderId }, sender_action: "typing_on" }
        );
    } catch (e) {}
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

// ========== WEBHOOK POST ==========
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    res.status(200).send('EVENT_RECEIVED');

    // ===== GÉRER LES CHANGES (feed + group_feed) =====
    if (body.entry[0]?.changes) {
        for (const change of body.entry[0].changes) {

            // Commentaires sur la PAGE
            if (change.field === 'feed' && change.value?.item === 'comment') {
                const commentId = change.value.comment_id;
                const senderId = change.value.from?.id;
                const senderName = change.value.from?.name || '';
                const commentMessage = change.value.message;

                if (!senderId || ADMIN_IDS.includes(senderId) || senderId === PAGE_ID) {
                    console.log('⏭️ Commentaire Page ignoré (admin/page/self)');
                    continue;
                }
                if (!commentMessage) continue;

                console.log(`💬 [PAGE] Commentaire de ${senderName}: ${commentMessage?.substring(0, 60)}`);
                const reply = await generateCommentReply(commentMessage, senderName);
                await replyToComment(commentId, reply);
                adminStats.commentsReplied++;
            }

            // Commentaires sur le GROUPE (ajoutés à la queue)
            if (change.field === 'group_feed' && change.value?.item === 'comment') {
                const groupId = change.value.group_id;
                const commentId = change.value.comment_id;
                const senderId = change.value.from?.id;
                const senderName = change.value.from?.name || '';
                const commentMessage = change.value.message;

                if (!senderId || ADMIN_IDS.includes(senderId)) {
                    console.log(`⏭️ Commentaire Groupe ignoré (admin): ${senderName}`);
                    continue;
                }
                if (!commentMessage) continue;

                if (!groupCommentQueue[groupId]) groupCommentQueue[groupId] = [];

                groupCommentQueue[groupId].push({
                    commentId, senderId, senderName,
                    message: commentMessage, timestamp: Date.now()
                });

                console.log(`📥 [GROUPE ${groupId}] Commentaire de ${senderName} ajouté à la queue (${groupCommentQueue[groupId].length} en attente)`);

                if (groupCommentQueue[groupId].length >= GROUP_BATCH_SIZE) {
                    processGroupQueue(groupId);
                }
            }
        }
        return;
    }

    // ===== GÉRER LES MESSAGES =====
    for (const entry of body.entry) {
        const event = entry.messaging[0];
        if (!event) continue;
        const senderId = event.sender.id;
        const messageText = event.message?.text;
        const attachments = event.message?.attachments;

        adminStats.totalMessages++;
        adminStats.totalUsers.add(senderId);

        const wasInactive = checkInactivity(senderId);

        if (attachments?.length > 0) {
            const type = attachments[0].type;
            const replies = {
                image: "📷 Image reçue / Image received\n\nNous ne pouvons pas voir les images. Décrivez votre demande par écrit.\nWe cannot see images. Please describe your request in text. 😊",
                audio: "🎤 Message vocal reçu / Voice message received\n\nNous ne pouvons pas l'écouter. Écrivez votre question.\nWe cannot listen to it. Please write your question. ✍️",
                video: "🎬 Vidéo reçue / Video received\n\nNous ne pouvons pas la visionner. Décrivez votre besoin.\nWe cannot view it. Please describe your need. 📝",
                file: "📁 Fichier reçu / File received\n\nNous ne pouvons pas l'ouvrir. Copiez-collez le contenu en texte.\nWe cannot open it. Please copy-paste the content as text. 📋",
                sticker: "😄 Merci pour le sticker ! / Thanks for the sticker!\n\nUne question ? Nous sommes là ! / A question? We're here! 🎓",
            };
            await sendFacebookMessage(senderId, replies[type] || replies.file);
            continue;
        }

        if (!messageText || event.message?.is_echo) continue;

        const text = messageText.trim();
        const textLower = text.toLowerCase();
        console.log(`📩 [${senderId.slice(-4)}] ${text.substring(0, 60)}`);

        if (ADMIN_IDS.includes(senderId) && textLower.startsWith('admin')) {
            const uptime = Math.floor((Date.now() - adminStats.startTime) / 60000);
            const statsMsg = `📊 STATISTIQUES ADMIN\n\n👥 Utilisateurs uniques: ${adminStats.totalUsers.size}\n💬 Messages totaux: ${adminStats.totalMessages}\n💬 Commentaires répondus: ${adminStats.commentsReplied}\n🎮 Quiz démarrés: ${adminStats.quizStarted}\n✅ Quiz terminés: ${adminStats.quizCompleted}\n📢 Follow requests: ${adminStats.followRequests}\n⏱️ Uptime: ${uptime} min\n\n🌐 Langues:\n${Object.entries(adminStats.languagesDetected).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
            await sendFacebookMessage(senderId, statsMsg);
            continue;
        }

        const detectedLang = detectLanguage(text);
        adminStats.languagesDetected[detectedLang] = (adminStats.languagesDetected[detectedLang] || 0) + 1;

        if (wasInactive && conversationHistory[senderId] && conversationHistory[senderId].length > 2) {
            const reminder = getFollowMessage(detectedLang, 'reminder');
            await sendFacebookMessage(senderId, reminder);
            lastActivity[senderId] = Date.now();
            continue;
        }

        if (!conversationHistory[senderId] || conversationHistory[senderId].length === 0) {
            const welcomeMsg = getFollowMessage(detectedLang, 'welcome');
            await sendFacebookMessage(senderId, welcomeMsg);
            adminStats.followRequests++;
            addToHistory(senderId, 'assistant', welcomeMsg);
        }

        if (['menu', 'aide', 'help', 'start', 'bonjour', 'hello', 'salut', 'hi', 'bonsoir'].some(w => textLower === w || textLower.startsWith(w + ' '))) {
            await sendFacebookMessage(senderId, getMainMenu(detectedLang === 'french' ? 'fr' : 'en'));
            continue;
        }

        if (textLower === 'stats' || textLower === 'statistiques') {
            const quota = userQuotas[senderId];
            const history = getHistory(senderId);
            const statsMsg = (detectedLang === 'french' || detectedLang === 'unknown')
                ? `📊 VOS STATISTIQUES\n\n💬 Messages: ${history.filter(h => h.role === 'user').length}\n🎯 Mode: ${quota?.mode === 'test' ? 'TEST' : 'QUOTIDIEN'}\n📅 Restants: ${quota ? (quota.mode === 'test' ? TEST_MODE_LIMIT - quota.count : DAILY_LIMIT - quota.count) : TEST_MODE_LIMIT}\n\n🎓 Continuez ! 🚀`
                : `📊 YOUR STATISTICS\n\n💬 Messages: ${history.filter(h => h.role === 'user').length}\n🎯 Mode: ${quota?.mode === 'test' ? 'TEST' : 'DAILY'}\n📅 Left: ${quota ? (quota.mode === 'test' ? TEST_MODE_LIMIT - quota.count : DAILY_LIMIT - quota.count) : TEST_MODE_LIMIT}\n\n🎓 Keep going! 🚀`;
            await sendFacebookMessage(senderId, statsMsg);
            continue;
        }

        if (textLower.includes('quiz français') || textLower.includes('quiz francais')) {
            adminStats.quizStarted++;
            await sendFacebookMessage(senderId, startQuiz(senderId, 'fr'));
            continue;
        }
        if (textLower.includes('quiz english') || textLower.includes('quiz anglais')) {
            adminStats.quizStarted++;
            await sendFacebookMessage(senderId, startQuiz(senderId, 'en'));
            continue;
        }
        if (quizSessions[senderId]) {
            const result = checkQuizAnswer(senderId, text);
            if (result) {
                if (result.includes('✅')) adminStats.quizCompleted++;
                await sendFacebookMessage(senderId, result);
                continue;
            }
        }

        if (textLower.includes('exercice français') || textLower.includes('exercice francais') || textLower.includes('pratique français')) {
            await sendFacebookMessage(senderId, exercicesFR[Math.floor(Math.random() * exercicesFR.length)]);
            continue;
        }
        if (textLower.includes('exercice english') || textLower.includes('exercise english') || textLower.includes('practice english')) {
            await sendFacebookMessage(senderId, exercicesEN[Math.floor(Math.random() * exercicesEN.length)]);
            continue;
        }

        if (textLower.startsWith('corrige ') || textLower.startsWith('correction ') || textLower.startsWith('correct ')) {
            const txt = text.substring(text.indexOf(' ') + 1).trim();
            if (txt.length < 5) {
                await sendFacebookMessage(senderId, "📝 Veuillez écrire le texte à corriger.\nEx: CORRIGE je suis aller a l'ecole");
                continue;
            }
            await sendTyping(senderId);
            addToHistory(senderId, 'user', text);
            const reply = await getAIReply(`Corrige ce texte et explique chaque erreur : "${txt}"`, senderId);
            addToHistory(senderId, 'assistant', reply);
            await sendFacebookMessage(senderId, reply);
            continue;
        }

        if (textLower.startsWith('résumé ') || textLower.startsWith('resume ') || textLower.startsWith('summarize ') || textLower.startsWith('summary ')) {
            const txt = text.substring(text.indexOf(' ') + 1).trim();
            if (txt.length < 30) {
                await sendFacebookMessage(senderId, "📄 Veuillez coller le texte à résumer.\nEx: RÉSUMÉ [texte long...]");
                continue;
            }
            await sendTyping(senderId);
            addToHistory(senderId, 'user', text);
            const reply = await getAIReply(`Fais un résumé clair et concis de ce texte : "${txt}"`, senderId);
            addToHistory(senderId, 'assistant', reply);
            await sendFacebookMessage(senderId, reply);
            continue;
        }

        if (textLower.startsWith('conjugue ') || textLower.startsWith('conjugate ')) {
            const verbe = text.substring(text.indexOf(' ') + 1).trim();
            if (!verbe) {
                await sendFacebookMessage(senderId, "📝 Précisez le verbe.\nEx: CONJUGUE être");
                continue;
            }
            await sendTyping(senderId);
            addToHistory(senderId, 'user', text);
            const reply = await getAIReply(`Conjugue le verbe "${verbe}" à tous les temps principaux.`, senderId);
            addToHistory(senderId, 'assistant', reply);
            await sendFacebookMessage(senderId, reply);
            continue;
        }

        const quota = checkQuota(senderId);
        if (!quota.allowed) {
            await sendFacebookMessage(senderId, `⚠️ Limite quotidienne atteinte.\n\nVous avez utilisé vos ${DAILY_LIMIT} messages aujourd'hui.\n\n🔄 Revenez demain !\n📌 Abonnez-vous à la page. 😊`);
            continue;
        }
        if (quota.mode === 'test' && quota.remaining === 0) {
            await sendFacebookMessage(senderId, `🎉 Bravo ! Vous avez utilisé vos ${TEST_MODE_LIMIT} messages TEST !\n\n🔄 Mode QUOTIDIEN activé : ${DAILY_LIMIT} messages/jour. 🚀`);
        }
        if (quota.mode === 'daily' && quota.remaining === 0) {
            await sendFacebookMessage(senderId, "ℹ️ Dernier message gratuit aujourd'hui. À demain ! 📅");
        }

        await sendTyping(senderId);
        addToHistory(senderId, 'user', text);
        const aiReply = await getAIReply(text, senderId);
        addToHistory(senderId, 'assistant', aiReply);
        await sendFacebookMessage(senderId, aiReply);
    }
});

// ========== RÉPONSE COMMENTAIRES PAGE ==========
async function replyToComment(commentId, message) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/comments`,
            { message, access_token: PAGE_ACCESS_TOKEN }
        );
        console.log('✅ Réponse commentaire Page envoyée');
    } catch (error) {
        console.error('❌ Erreur réponse Page:', error.message);
    }
}

async function generateCommentReply(userComment, userName = '') {
    const name = userName ? ` ${userName}` : '';
    const prompt = `Un utilisateur${name} a commenté sur notre page éducative "Ofisialy Sylvain".

Son commentaire : "${userComment}"

Tu es le community manager de la page. Générez une réponse :
- CHALEUREUSE et PROFESSIONNELLE (vouvoiement)
- Remercie la personne pour son commentaire
- Fais référence au contenu de son commentaire si pertinent
- Invite-la à découvrir notre assistant IA sur Messenger (m.me/OfisialySylvain)
- Rappelle que la page propose des quiz, exercices, corrections gratuits en Français et Anglais
- Termine par une note positive
- 3-4 phrases maximum
- En français UNIQUEMENT
- PAS de Markdown
- 2 emojis maximum`;

    try {
        const currentKey = getApiKey();
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            { model: AI_MODEL, max_tokens: 200, temperature: 0.7, messages: [{ role: 'user', content: prompt }] },
            { headers: { 'Authorization': `Bearer ${currentKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://ofisialysylvain.com', 'X-Title': 'Ofisialy Sylvain Bot' }, timeout: 15000 }
        );
        return response.data.choices[0]?.message?.content || "Merci pour votre commentaire ! Découvrez notre assistant IA gratuit sur Messenger pour apprendre le Français et l'Anglais. 🎓✨";
    } catch (error) {
        return "Merci pour votre commentaire ! Découvrez notre assistant IA gratuit sur Messenger pour apprendre le Français et l'Anglais. 🎓✨";
    }
}

// ========== RÉPONSE COMMENTAIRES GROUPE ==========
async function replyToGroupComment(groupId, commentId, message) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/comments`,
            { message, access_token: PAGE_ACCESS_TOKEN }
        );
        console.log(`✅ Réponse commentaire groupe ${groupId} envoyée`);
    } catch (error) {
        console.error(`❌ Erreur réponse groupe ${groupId}:`, error.message);
    }
}

async function generateGroupCommentReply(userComment, userName = '', groupId = '') {
    const name = userName ? ` ${userName}` : '';
    const prompt = `Un membre${name} a commenté dans un groupe Facebook éducatif.

Son commentaire : "${userComment}"

Tu es l'assistant de la page "Ofisialy Sylvain". Générez une réponse :
- CHALEUREUSE et PROFESSIONNELLE (vouvoiement)
- Remercie la personne pour sa participation dans le groupe
- Fais référence au contenu de son commentaire si pertinent
- Invite-la à découvrir notre assistant IA 100% GRATUIT sur Messenger (m.me/OfisialySylvain)
- Rappelle que notre page propose des quiz, exercices, corrections en Français et Anglais
- Termine par une note positive
- 3-4 phrases maximum
- En français UNIQUEMENT
- PAS de Markdown
- 2 emojis maximum
- Mentionne que le service est GRATUIT`;

    try {
        const currentKey = getApiKey();
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            { model: AI_MODEL, max_tokens: 200, temperature: 0.7, messages: [{ role: 'user', content: prompt }] },
            { headers: { 'Authorization': `Bearer ${currentKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://ofisialysylvain.com', 'X-Title': 'Ofisialy Sylvain Bot' }, timeout: 15000 }
        );
        return response.data.choices[0]?.message?.content || "Merci pour votre participation dans ce groupe ! Découvrez notre assistant IA 100% GRATUIT sur Messenger pour progresser en Français et en Anglais avec des quiz personnalisés. 🎓✨";
    } catch (error) {
        return "Merci pour votre participation dans ce groupe ! Découvrez notre assistant IA 100% GRATUIT sur Messenger pour progresser en Français et en Anglais. 🎓✨";
    }
}

// ========== AI REPLY ==========
async function getAIReply(userMessage, senderId) {
    const history = getHistory(senderId);
    const systemPrompt = `Vous êtes l'assistant IA officiel de la page "Ofisialy Sylvain", créée par Sylvain Solofoniaina le 01 Mai 2026.

🎯 RÔLE : Assistant pédagogique expert en FRANÇAIS et ANGLAIS.

🌐 LANGUES : Vous comprenez et parlez TOUTES les langues. Répondez TOUJOURS dans LA MÊME LANGUE que l'utilisateur.

⚠️ SI L'UTILISATEUR N'ÉCRIT PAS EN FRANÇAIS NI EN ANGLAIS :
1. Répondez dans SA LANGUE pour le saluer.
2. Expliquez que vos COMPÉTENCES D'ENSEIGNEMENT sont UNIQUEMENT en FRANÇAIS et ANGLAIS.
3. Proposez de passer en Français ou Anglais pour apprendre.
4. NE DONNEZ PAS de leçon de grammaire dans une autre langue.

📋 FORMATAGE :
- PAS de Markdown.
- MAJUSCULES pour les titres.
- Émojis avec modération.
- Réponses courtes et claires.
- Vouvoyez en français.

📢 À la fin de chaque réponse, ajoutez UNE phrase d'encouragement à suivre/liker/partager la page.

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
            console.log('✅ AI Reply success');
            return response.data.choices[0].message.content;
        } catch (error) {
            console.warn(`⚠️ Erreur clé #${currentKeyIndex + 1}: ${error.response?.status || error.message}`);
            if (error.response?.status === 402 || error.response?.status === 429) {
                if (hasNextKey()) { getNextApiKey(); continue; }
            }
            if (error.code !== 'ECONNABORTED') break;
        }
    }
    return "🔧 Service momentanément indisponible. Merci de réessayer. 🙏";
}

// ========== SEND MESSAGE ==========
async function sendFacebookMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: recipientId }, message: { text } }
        );
        console.log('✅ Sent');
    } catch (error) {
        console.error('❌ Facebook send error:', error.message);
    }
}

// ========== TIMER QUEUES GROUPES ==========
setInterval(() => {
    for (const groupId of Object.keys(groupCommentQueue)) {
        if (groupCommentQueue[groupId]?.length > 0) {
            processGroupQueue(groupId);
        }
    }
}, 5 * 60 * 1000);

// ========== START ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Ofisialy Sylvain Bot — Port ${PORT}`));
