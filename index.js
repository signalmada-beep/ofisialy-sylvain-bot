require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "openai/gpt-4o-mini-search-preview";

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

function addToHistory(senderId, role, content) {
    if (!conversationHistory[senderId]) conversationHistory[senderId] = [];
    conversationHistory[senderId].push({ role, content });
    if (conversationHistory[senderId].length > MAX_HISTORY * 2) {
        conversationHistory[senderId] = conversationHistory[senderId].slice(-MAX_HISTORY * 2);
    }
}

function getHistory(senderId) {
    return conversationHistory[senderId] || [];
}

// ========== QUIZ SYSTEM ==========
const quizSessions = {};

const quizFR = [
    { question: "❓ Conjuguez le verbe ALLER au présent, 1ère personne du singulier :", answer: ["je vais"], hint: "Je ___ au marché." },
    { question: "❓ Quel est le féminin de BEAU ?", answer: ["belle"], hint: "Une ___ fleur." },
    { question: "❓ Complétez : 'Il faut que tu ___ (venir) ici.'", answer: ["viennes"], hint: "Subjonctif présent." },
    { question: "❓ Quel est le contraire de RAPIDE ?", answer: ["lent", "lente", "lente"], hint: "Une tortue est très ___." },
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
            ? `✅ BRAVO ! Bonne réponse ! ${stars}\n\nLa réponse était : "${q.answer[0]}"\n\n🔄 Tapez QUIZ FRANÇAIS pour un autre ou QUIZ ANGLAIS pour changer !`
            : `✅ CORRECT! Well done! ${stars}\n\nThe answer was: "${q.answer[0]}"\n\n🔄 Type QUIZ ENGLISH for another or QUIZ FRANÇAIS to switch!`;
    } else if (session.attempts >= 2) {
        delete quizSessions[senderId];
        return session.lang === 'fr'
            ? `❌ Pas tout à fait...\n\n✅ La bonne réponse était : "${q.answer[0]}"\n\n💪 Ne vous découragez pas ! Tapez QUIZ FRANÇAIS pour réessayer !`
            : `❌ Not quite...\n\n✅ The correct answer was: "${q.answer[0]}"\n\n💪 Don't give up! Type QUIZ ENGLISH to try again!`;
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
    startTime: Date.now()
};

// ✅ Ampidiro ny username Facebook anao (ilay hita @URL profil-nao)
const ADMIN_IDS = ["SylvainOfisialy"];

// ========== DETECT LANGUAGE ==========
const waitingUsers = {};

function getWaitingMessage(language, type, remainingMinutes) {
    const messages = {
        'malagasy': {
            first: "🌐 *Fiteny Malagasy*\n\nMiala tsiny fa mbola tsy mahay an'io fiteny io izahay. Manao ahoana! 😊\n\n📩 *Andraso kely* fa misy olona afaka manampy anao. Raha tsy misy mamaly ao anatin'ny 5 minitra, dia azafady mba manorata amin'ny FRANÇAIS na ANGLAIS.\n\n⏳ *Miandry mpandray olombelona...* 🙏",
            waiting: "⏳ *Mbola miandry olona afaka manampy anao izahay.*\n\nRaha tsy misy mamaly ao anatin'ny {minutes} minitra, azafady manorata amin'ny FRANÇAIS na ANGLAIS. 🙏",
            timeout: "⏰ *Tsy nisy olona afaka nanampy anao tamin'ny teny Malagasy.*\n\nAzafady mba manorata amin'ny FRANÇAIS na ANGLAIS. Misaotra! 🙏"
        },
        'unknown': {
            first: "🌐 *Langue non supportée*\n\nNous sommes désolés, nous ne comprenons pas encore cette langue. 😊\n\n📩 *Veuillez patienter* — quelqu'un pourra peut-être vous aider. Si personne ne répond dans 5 minutes, merci d'écrire en FRANÇAIS ou ENGLISH.\n\n⏳ *En attente d'un humain...* 🙏",
            waiting: "⏳ *Toujours en attente.*\n\nSi personne ne répond dans {minutes} minutes, merci d'écrire en FRANÇAIS ou ENGLISH. 🙏",
            timeout: "⏰ *Personne n'a pu vous aider.*\n\nMerci d'écrire en FRANÇAIS ou ENGLISH. Thank you! 🙏"
        }
    };
    const langMsgs = messages[language] || messages['unknown'];
    if (type === 'first') return langMsgs.first;
    if (type === 'waiting') return langMsgs.waiting.replace(/{minutes}/g, remainingMinutes || '?');
    return langMsgs.timeout;
}

function detectLanguage(text) {
    const normalized = text.toLowerCase().trim();
    const malagasyWords = ['manao', 'ahoana', 'misaotra', 'azafady', 'ianao', 'mbola', 'tsara', 'mety', 'aho', 'anao', 'ny', 'ary', 'fa', 'koa', 've', 'inona', 'mba'];
    const frenchWords = ['bonjour', 'salut', 'merci', 'bonsoir', 'comment', 'pourquoi', 'quand', 'je', 'vous', 'nous', 'notre', 'votre', 'bonne', 'jour', 'oui', 'non', 'est', 'une', 'les', 'des'];
    const englishWords = ['hello', 'hi', 'thanks', 'thank', 'good', 'morning', 'how', 'what', 'when', 'where', 'why', 'who', 'please', 'sorry', 'help', 'the', 'and', 'is', 'are', 'was'];
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
    if (mg >= 2) return 'malagasy';
    if (fr >= 2) return 'french';
    if (en >= 2) return 'english';
    return 'unknown';
}

// ========== MENU PRINCIPAL ==========
function getMainMenu(lang) {
    if (lang === 'fr' || lang === 'french') {
        return `👋 Bienvenue sur Ofisialy Sylvain ! 🎓

Voici ce que nous pouvons faire pour vous :

📚 APPRENTISSAGE
- Tapez QUIZ FRANÇAIS pour un quiz
- Tapez EXERCICE FRANÇAIS pour pratiquer
- Posez n'importe quelle question de grammaire

🇬🇧 ENGLISH LEARNING
- Tapez QUIZ ENGLISH pour un quiz
- Tapez EXERCICE ENGLISH pour pratiquer
- Ask any grammar question!

📖 CORRECTIONS
- Tapez CORRIGE [texte] pour corriger
- Tapez RÉSUMÉ [texte] pour résumer
- Tapez CONJUGUE [verbe] pour conjuguer
- Aide rédaction (lettre, CV, email)

📊 AUTRES
- Tapez STATS pour vos statistiques
- Tapez AIDE pour revoir ce menu

🚀 Commençons ! Que puis-je faire pour vous ?`;
    }
    return `👋 Welcome to Ofisialy Sylvain! 🎓

Here's what we can do for you:

📚 LEARNING
- Type QUIZ ENGLISH for a quiz
- Type EXERCISE ENGLISH to practice
- Ask any grammar question!

🇫🇷 FRANÇAIS
- Tapez QUIZ FRANÇAIS pour un quiz
- Tapez EXERCICE FRANÇAIS pour pratiquer

📖 CORRECTIONS
- Type CORRECT [text] to fix mistakes
- Type SUMMARIZE [text] for a summary
- Type CONJUGATE [verb] for conjugation
- Writing help (letter, CV, email)

📊 OTHER
- Type STATS for your statistics
- Type HELP to see this menu again

🚀 Let's start! How can I help you?`;
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

    for (const entry of body.entry) {
        const event = entry.messaging[0];
        if (!event) continue;
        const senderId = event.sender.id;
        const messageText = event.message?.text;
        const attachments = event.message?.attachments;

        // Stats
        adminStats.totalMessages++;
        adminStats.totalUsers.add(senderId);

        // Attachments
        if (attachments?.length > 0) {
            const type = attachments[0].type;
            const replies = {
                image: "📷 Image reçue / Image received\n\nNous ne pouvons pas voir les images. Décrivez votre demande par écrit.\nWe cannot see images. Please describe your request in text. 😊",
                audio: "🎤 Message vocal reçu / Voice message received\n\nNous ne pouvons pas l'écouter. Écrivez votre question.\nWe cannot listen to it. Please write your question. ✍️",
                video: "🎬 Vidéo reçue / Video received\n\nNous ne pouvons pas la visionner. Décrivez votre besoin.\nWe cannot view it. Please describe your need. 📝",
                file: "📁 Fichier reçu / File received\n\nNous ne pouvons pas l'ouvrir. Copiez-collez le contenu en texte.\nWe cannot open it. Please copy-paste the content as text. 📋",
                sticker: "😄 Merci pour le sticker ! / Thanks for the sticker!\n\nUne question ? / A question? Nous sommes là ! / We're here! 🎓",
            };
            await sendFacebookMessage(senderId, replies[type] || replies.file);
            continue;
        }

        if (!messageText || event.message?.is_echo) continue;

        const text = messageText.trim();
        const textLower = text.toLowerCase();
        console.log(`📩 [${senderId.slice(-4)}] ${text.substring(0, 60)}`);

        // ===== COMMANDES ADMIN (avant détection langue) =====
        if (ADMIN_IDS.includes(senderId) && textLower.startsWith('admin')) {
            const uptime = Math.floor((Date.now() - adminStats.startTime) / 60000);
            const statsMsg = `📊 STATISTIQUES ADMIN\n\n👥 Utilisateurs uniques: ${adminStats.totalUsers.size}\n💬 Messages totaux: ${adminStats.totalMessages}\n🎮 Quiz démarrés: ${adminStats.quizStarted}\n✅ Quiz terminés: ${adminStats.quizCompleted}\n⏱️ Uptime: ${uptime} min\n\n🌐 Langues:\n${Object.entries(adminStats.languagesDetected).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
            await sendFacebookMessage(senderId, statsMsg);
            continue;
        }

        // ===== DETECTION LANGUE =====
        const detectedLang = detectLanguage(text);
        const isSupported = detectedLang === 'french' || detectedLang === 'english';

        adminStats.languagesDetected[detectedLang] = (adminStats.languagesDetected[detectedLang] || 0) + 1;

        // Langue non supportée avec attente
        if (!isSupported) {
            const waitingMsgs = {
                malagasy: "🌐 Fiteny Malagasy\n\nMiala tsiny fa mbola tsy mahay an'io fiteny io izahay. 😊\n\nAzafady manorata amin'ny FRANÇAIS na ANGLAIS. 🙏",
                arabic: "🌐 نعتذر، لا نتحدث هذه اللغة بعد.\n\nيرجى الكتابة بالفرنسية أو الإنجليزية. 🙏",
                chinese: "🌐 抱歉，我们还不懂这种语言。\n\n请用法语或英语书写。🙏",
                russian: "🌐 Извините, мы пока не говорим на этом языке.\n\nПожалуйста, напишите на французском или английском. 🙏",
                japanese: "🌐 申し訳ありません。フランス語か英語で書いてください。🙏",
                korean: "🌐 죄송합니다. 프랑스어나 영어로 써 주세요. 🙏",
                unknown: "🌐 Language not supported yet.\n\nPlease write in FRANÇAIS or ENGLISH. 🙏",
            };
            await sendFacebookMessage(senderId, waitingMsgs[detectedLang] || waitingMsgs.unknown);
            continue;
        }

        // ===== MENU / AIDE =====
        if (['menu', 'aide', 'help', 'start', 'bonjour', 'hello', 'salut', 'hi', 'bonsoir'].some(w => textLower === w || textLower.startsWith(w + ' '))) {
            await sendFacebookMessage(senderId, getMainMenu(detectedLang));
            continue;
        }

        // ===== STATS UTILISATEUR =====
        if (textLower === 'stats' || textLower === 'statistiques') {
            const quota = userQuotas[senderId];
            const history = getHistory(senderId);
            const statsMsg = detectedLang === 'french'
                ? `📊 VOS STATISTIQUES\n\n💬 Messages échangés: ${history.filter(h => h.role === 'user').length}\n🎯 Mode: ${quota?.mode === 'test' ? 'TEST (gratuit)' : 'QUOTIDIEN'}\n📅 Messages restants aujourd'hui: ${quota ? (quota.mode === 'test' ? TEST_MODE_LIMIT - quota.count : DAILY_LIMIT - quota.count) : TEST_MODE_LIMIT}\n\n🎓 Continuez à apprendre ! 🚀`
                : `📊 YOUR STATISTICS\n\n💬 Messages exchanged: ${history.filter(h => h.role === 'user').length}\n🎯 Mode: ${quota?.mode === 'test' ? 'TEST (free)' : 'DAILY'}\n📅 Messages left today: ${quota ? (quota.mode === 'test' ? TEST_MODE_LIMIT - quota.count : DAILY_LIMIT - quota.count) : TEST_MODE_LIMIT}\n\n🎓 Keep learning! 🚀`;
            await sendFacebookMessage(senderId, statsMsg);
            continue;
        }

        // ===== QUIZ =====
        if (textLower.includes('quiz français') || textLower.includes('quiz francais')) {
            adminStats.quizStarted++;
            const q = startQuiz(senderId, 'fr');
            await sendFacebookMessage(senderId, q);
            continue;
        }
        if (textLower.includes('quiz english') || textLower.includes('quiz anglais')) {
            adminStats.quizStarted++;
            const q = startQuiz(senderId, 'en');
            await sendFacebookMessage(senderId, q);
            continue;
        }

        // Réponse quiz en cours
        if (quizSessions[senderId]) {
            const result = checkQuizAnswer(senderId, text);
            if (result) {
                if (result.includes('✅')) adminStats.quizCompleted++;
                await sendFacebookMessage(senderId, result);
                continue;
            }
        }

        // ===== CORRECTION =====
        if (textLower.startsWith('corrige ') || textLower.startsWith('correction ') || textLower.startsWith('correct ')) {
            const texteACorriger = text.substring(text.indexOf(' ') + 1).trim();
            if (texteACorriger.length < 5) {
                const msg = detectedLang === 'french'
                    ? "📝 Veuillez écrire le texte à corriger après la commande.\nExemple : CORRIGE je suis aller a l'ecole"
                    : "📝 Please write the text to correct after the command.\nExample: CORRECT i goes to school";
                await sendFacebookMessage(senderId, msg);
                continue;
            }
            await sendTyping(senderId);
            const prompt = detectedLang === 'french'
                ? `Corrigez ce texte et expliquez chaque erreur : "${texteACorriger}"`
                : `Correct this text and explain each mistake: "${texteACorriger}"`;
            addToHistory(senderId, 'user', prompt);
            const correction = await getAIReply(prompt, senderId, detectedLang);
            addToHistory(senderId, 'assistant', correction);
            await sendFacebookMessage(senderId, correction);
            continue;
        }

        // ===== RÉSUMÉ =====
        if (textLower.startsWith('résumé ') || textLower.startsWith('resume ') || textLower.startsWith('summarize ') || textLower.startsWith('summary ')) {
            const texteAResumer = text.substring(text.indexOf(' ') + 1).trim();
            if (texteAResumer.length < 30) {
                const msg = detectedLang === 'french'
                    ? "📄 Veuillez coller le texte à résumer après la commande.\nExemple : RÉSUMÉ [votre texte long...]"
                    : "📄 Please paste the text to summarize after the command.\nExample: SUMMARIZE [your long text...]";
                await sendFacebookMessage(senderId, msg);
                continue;
            }
            await sendTyping(senderId);
            const prompt = detectedLang === 'french'
                ? `Faites un résumé clair et concis de ce texte : "${texteAResumer}"`
                : `Make a clear and concise summary of this text: "${texteAResumer}"`;
            addToHistory(senderId, 'user', prompt);
            const resume = await getAIReply(prompt, senderId, detectedLang);
            addToHistory(senderId, 'assistant', resume);
            await sendFacebookMessage(senderId, resume);
            continue;
        }

        // ===== CONJUGAISON =====
        if (textLower.startsWith('conjugue ') || textLower.startsWith('conjugate ')) {
            const verbe = text.substring(text.indexOf(' ') + 1).trim();
            if (!verbe) {
                const msg = detectedLang === 'french'
                    ? "📝 Veuillez préciser le verbe.\nExemple : CONJUGUE être"
                    : "📝 Please specify the verb.\nExample: CONJUGATE be";
                await sendFacebookMessage(senderId, msg);
                continue;
            }
            await sendTyping(senderId);
            const prompt = detectedLang === 'french'
                ? `Conjuguez le verbe "${verbe}" à tous les temps principaux en français. Présentez clairement chaque temps.`
                : `Conjugate the verb "${verbe}" in all main tenses in English. Present each tense clearly.`;
            addToHistory(senderId, 'user', prompt);
            const conjugaison = await getAIReply(prompt, senderId, detectedLang);
            addToHistory(senderId, 'assistant', conjugaison);
            await sendFacebookMessage(senderId, conjugaison);
            continue;
        }

        // ===== EXERCICES =====
        if (textLower.includes('exercice français') || textLower.includes('exercice francais') || textLower.includes('pratique français')) {
            const ex = exercicesFR[Math.floor(Math.random() * exercicesFR.length)];
            await sendFacebookMessage(senderId, ex);
            continue;
        }
        if (textLower.includes('exercice english') || textLower.includes('exercise english') || textLower.includes('practice english')) {
            const ex = exercicesEN[Math.floor(Math.random() * exercicesEN.length)];
            await sendFacebookMessage(senderId, ex);
            continue;
        }

        // ===== QUOTA =====
        const quota = checkQuota(senderId);
        if (!quota.allowed) {
            const msg = detectedLang === 'french'
                ? `⚠️ Limite quotidienne atteinte.\n\nVous avez utilisé vos ${DAILY_LIMIT} messages gratuits aujourd'hui. 📊\n\n🔄 Revenez demain pour continuer !\n\n📌 Abonnez-vous à la page pour rester informé(e). 😊`
                : `⚠️ Daily limit reached.\n\nYou've used your ${DAILY_LIMIT} free messages today. 📊\n\n🔄 Come back tomorrow!\n\n📌 Follow our page to stay updated. 😊`;
            await sendFacebookMessage(senderId, msg);
            continue;
        }

        if (quota.mode === 'test' && quota.remaining === 0) {
            const msg = detectedLang === 'french'
                ? `🎉 Félicitations ! Vous avez utilisé vos ${TEST_MODE_LIMIT} messages TEST gratuits !\n\n🔄 Vous passez en mode QUOTIDIEN : ${DAILY_LIMIT} messages par jour. 🚀`
                : `🎉 Congratulations! You've used your ${TEST_MODE_LIMIT} free TEST messages!\n\n🔄 Switching to DAILY mode: ${DAILY_LIMIT} messages per day. 🚀`;
            await sendFacebookMessage(senderId, msg);
        }

        // ===== AI REPLY avec historique =====
        await sendTyping(senderId);
        addToHistory(senderId, 'user', text);
        const aiReply = await getAIReply(text, senderId, detectedLang);
        addToHistory(senderId, 'assistant', aiReply);
        await sendFacebookMessage(senderId, aiReply);
    }
});

// ========== AI REPLY ==========
async function getAIReply(userMessage, senderId, lang) {
    try {
        const history = getHistory(senderId);
        const systemPrompt = `Vous êtes l'assistant IA officiel de la page "Ofisialy Sylvain", créée par Sylvain Solofoniaina le 01 Mai 2026. Vous répondez UNIQUEMENT en ${lang === 'french' ? 'FRANÇAIS' : 'ANGLAIS'}.

🎯 RÔLE : Assistant pédagogique expert en FRANÇAIS et ANGLAIS.

📋 COMPÉTENCES :
- Grammaire, conjugaison, orthographe, vocabulaire
- Synonymes, antonymes, homophones
- Compréhension de texte, résumé, analyse
- Rédaction : lettre, CV, email, dissertation
- Préparation examens (BAC, TOEFL, IELTS, DELF)
- Exercices pratiques et corrections détaillées
- Figures de style, littérature, auteurs
- Expressions idiomatiques, proverbes
- Phonétique (description écrite uniquement)
- Traduction assistée (pas automatique)

📋 RÈGLES :
- Vouvoyez TOUJOURS.
- PAS de Markdown (*bold*, #titre) — Messenger ne supporte pas.
- Utilisez des MAJUSCULES pour les titres.
- Émojis avec modération.
- Réponses courtes et claires (max 400 mots).
- Proposez toujours un exercice ou une question de suivi.
- Encouragez et motivez l'apprenant.

🚫 LIMITES : Pas d'images, fichiers, vidéos, audio.
📞 Contact Sylvain : via la page Facebook officielle.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-8),
            { role: 'user', content: userMessage }
        ];

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: AI_MODEL,
                max_tokens: 500,
                temperature: 0.6,
                messages
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://ofisialysylvain.com',
                    'X-Title': 'Ofisialy Sylvain Bot'
                },
                timeout: 30000
            }
        );
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('❌ AI Error:', error.message);
        if (error.response?.status === 402) return lang === 'french'
            ? "🔧 Maintenance en cours. Revenez dans quelques heures. 🙏"
            : "🔧 Maintenance in progress. Please come back in a few hours. 🙏";
        if (error.response?.status === 429) return lang === 'french'
            ? "⏳ Trop de demandes. Réessayez dans quelques minutes. 🙏"
            : "⏳ Too many requests. Please try again in a few minutes. 🙏";
        if (error.code === 'ECONNABORTED') return lang === 'french'
            ? "⏳ Délai dépassé. Reformulez votre question plus brièvement."
            : "⏳ Timeout. Please rephrase your question more briefly.";
        return lang === 'french'
            ? "🔧 Erreur temporaire. Veuillez réessayer. 🙏"
            : "🔧 Temporary error. Please try again. 🙏";
    }
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

// ========== START ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Ofisialy Sylvain Bot — Port ${PORT}`));
