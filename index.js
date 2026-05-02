require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "openai/gpt-4o-mini-search-preview";
const LANGBLY_API_KEY = "BtXwg98wQwy7SxbxgKz7Bp";
const LANGBLY_TRANSLATE_URL = "https://api.langbly.com/v1/translate";

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
    translationsDone: 0,
    startTime: Date.now()
};

const ADMIN_IDS = ["SylvainOfisialy"];

// ========== DETECT LANGUAGE ==========
const waitingUsers = {};

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

// ========== TRANSLATION ==========
async function translateText(text, targetLang) {
    try {
        const response = await axios.post(
            LANGBLY_TRANSLATE_URL,
            { text, target: targetLang },
            {
                headers: {
                    'Authorization': `Bearer ${LANGBLY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        return response.data.translatedText || response.data.translation || response.data.text || null;
    } catch (error) {
        console.error('❌ Translation error:', error.message);
        return null;
    }
}

function getLangCode(detectedLang) {
    const langMap = {
        'malagasy': 'mg',
        'spanish': 'es',
        'arabic': 'ar',
        'chinese': 'zh',
        'russian': 'ru',
        'japanese': 'ja',
        'korean': 'ko',
        'unknown': 'fr'
    };
    return langMap[detectedLang] || 'fr';
}

// ========== MENU PRINCIPAL ==========
function getMainMenu(lang) {
    if (lang === 'fr' || lang === 'french') {
        return `👋 Bienvenue sur Ofisialy Sylvain ! 🎓

Voici ce que nous pouvons faire pour vous :

📚 APPRENTISSAGE FRANÇAIS & ANGLAIS
- Tapez QUIZ FRANÇAIS pour un quiz
- Tapez EXERCICE FRANÇAIS pour pratiquer
- Tapez CONJUGUE [verbe] pour conjuguer
- Posez n'importe quelle question de grammaire

🇬🇧 ENGLISH LEARNING
- Type QUIZ ENGLISH for a quiz
- Type EXERCISE ENGLISH to practice
- Type CONJUGATE [verb] for conjugation
- Ask any grammar question!

📖 CORRECTIONS & OUTILS
- Tapez CORRIGE [texte] pour corriger
- Tapez RÉSUMÉ [texte] pour résumer
- Aide rédaction (lettre, CV, email)

🌐 AUTRES LANGUES
- Nous acceptons toutes les langues !
- Votre message sera traduit automatiquement
- Nos compétences principales restent le Français et l'Anglais

📊 AUTRES
- Tapez STATS pour vos statistiques
- Tapez AIDE pour revoir ce menu

🚀 Commençons ! Que puis-je faire pour vous ?`;
    }
    return `👋 Welcome to Ofisialy Sylvain! 🎓

Here's what we can do for you:

📚 FRENCH & ENGLISH LEARNING
- Type QUIZ FRANÇAIS for a quiz
- Type EXERCICE FRANÇAIS to practice
- Type CONJUGUE [verb] for conjugation
- Ask any grammar question!

🇫🇷 APPRENTISSAGE
- Type QUIZ FRANÇAIS for a quiz
- Type EXERCICE FRANÇAIS to practice
- Type CONJUGUE [verb] for conjugation

📖 CORRECTIONS & TOOLS
- Type CORRECT [text] to fix mistakes
- Type SUMMARIZE [text] for a summary
- Writing help (letter, CV, email)

🌐 OTHER LANGUAGES
- We accept all languages!
- Your message will be automatically translated
- Our core expertise remains French and English

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
            const statsMsg = `📊 STATISTIQUES ADMIN\n\n👥 Utilisateurs uniques: ${adminStats.totalUsers.size}\n💬 Messages totaux: ${adminStats.totalMessages}\n🎮 Quiz démarrés: ${adminStats.quizStarted}\n✅ Quiz terminés: ${adminStats.quizCompleted}\n🔄 Traductions: ${adminStats.translationsDone}\n⏱️ Uptime: ${uptime} min\n\n🌐 Langues:\n${Object.entries(adminStats.languagesDetected).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
            await sendFacebookMessage(senderId, statsMsg);
            continue;
        }

        // ===== DETECTION LANGUE =====
        const detectedLang = detectLanguage(text);
        const isSupported = detectedLang === 'french' || detectedLang === 'english';

        adminStats.languagesDetected[detectedLang] = (adminStats.languagesDetected[detectedLang] || 0) + 1;

        // ===== MENU / AIDE =====
        if (['menu', 'aide', 'help', 'start', 'bonjour', 'hello', 'salut', 'hi', 'bonsoir'].some(w => textLower === w || textLower.startsWith(w + ' '))) {
            await sendFacebookMessage(senderId, getMainMenu(detectedLang === 'french' ? 'fr' : 'en'));
            continue;
        }

        // ===== STATS UTILISATEUR =====
        if (textLower === 'stats' || textLower === 'statistiques') {
            const quota = userQuotas[senderId];
            const history = getHistory(senderId);
            const statsMsg = (detectedLang === 'french' || detectedLang === 'unknown')
                ? `📊 VOS STATISTIQUES\n\n💬 Messages échangés: ${history.filter(h => h.role === 'user').length}\n🎯 Mode: ${quota?.mode === 'test' ? 'TEST (gratuit)' : 'QUOTIDIEN'}\n📅 Messages restants aujourd'hui: ${quota ? (quota.mode === 'test' ? TEST_MODE_LIMIT - quota.count : DAILY_LIMIT - quota.count) : TEST_MODE_LIMIT}\n\n🎓 Continuez à apprendre ! 🚀`
                : `📊 YOUR STATISTICS\n\n💬 Messages exchanged: ${history.filter(h => h.role === 'user').length}\n🎯 Mode: ${quota?.mode === 'test' ? 'TEST (free)' : 'DAILY'}\n📅 Messages left today: ${quota ? (quota.mode === 'test' ? TEST_MODE_LIMIT - quota.count : DAILY_LIMIT - quota.count) : TEST_MODE_LIMIT}\n\n🎓 Keep learning! 🚀`;
            await sendFacebookMessage(senderId, statsMsg);
            continue;
        }

        // ===== COMMANDES EN FRANÇAIS (peut importe la langue détectée) =====
        if (textLower.includes('quiz français') || textLower.includes('quiz francais')) {
            adminStats.quizStarted++;
            const q = startQuiz(senderId, 'fr');
            await sendFacebookMessage(senderId, q);
            continue;
        }
        if (textLower.includes('exercice français') || textLower.includes('exercice francais') || textLower.includes('pratique français')) {
            const ex = exercicesFR[Math.floor(Math.random() * exercicesFR.length)];
            await sendFacebookMessage(senderId, ex);
            continue;
        }

        // ===== COMMANDES EN ANGLAIS =====
        if (textLower.includes('quiz english') || textLower.includes('quiz anglais')) {
            adminStats.quizStarted++;
            const q = startQuiz(senderId, 'en');
            await sendFacebookMessage(senderId, q);
            continue;
        }
        if (textLower.includes('exercice english') || textLower.includes('exercise english') || textLower.includes('practice english')) {
            const ex = exercicesEN[Math.floor(Math.random() * exercicesEN.length)];
            await sendFacebookMessage(senderId, ex);
            continue;
        }

        // ===== CORRECTION =====
        if (textLower.startsWith('corrige ') || textLower.startsWith('correction ') || textLower.startsWith('correct ')) {
            const texteACorriger = text.substring(text.indexOf(' ') + 1).trim();
            if (texteACorriger.length < 5) {
                await sendFacebookMessage(senderId, "📝 Veuillez écrire le texte à corriger.\nExemple : CORRIGE je suis aller a l'ecole\n\n📝 Please write the text to correct.\nExample: CORRECT i goes to school");
                continue;
            }
            await sendTyping(senderId);
            const prompt = `Corrigez ce texte et expliquez chaque erreur en français : "${texteACorriger}"`;
            addToHistory(senderId, 'user', prompt);
            const correction = await getAIReply(prompt, senderId, 'french');
            addToHistory(senderId, 'assistant', correction);
            await sendFacebookMessage(senderId, correction);
            continue;
        }

        // ===== RÉSUMÉ =====
        if (textLower.startsWith('résumé ') || textLower.startsWith('resume ') || textLower.startsWith('summarize ') || textLower.startsWith('summary ')) {
            const texteAResumer = text.substring(text.indexOf(' ') + 1).trim();
            if (texteAResumer.length < 30) {
                await sendFacebookMessage(senderId, "📄 Veuillez coller le texte à résumer.\nExemple : RÉSUMÉ [texte long...]\n\n📄 Please paste the text to summarize.\nExample: SUMMARIZE [long text...]");
                continue;
            }
            await sendTyping(senderId);
            const prompt = `Faites un résumé clair et concis de ce texte en français : "${texteAResumer}"`;
            addToHistory(senderId, 'user', prompt);
            const resume = await getAIReply(prompt, senderId, 'french');
            addToHistory(senderId, 'assistant', resume);
            await sendFacebookMessage(senderId, resume);
            continue;
        }

        // ===== CONJUGAISON =====
        if (textLower.startsWith('conjugue ') || textLower.startsWith('conjugate ')) {
            const verbe = text.substring(text.indexOf(' ') + 1).trim();
            if (!verbe) {
                await sendFacebookMessage(senderId, "📝 Veuillez préciser le verbe.\nExemple : CONJUGUE être\n\n📝 Please specify the verb.\nExample: CONJUGATE be");
                continue;
            }
            await sendTyping(senderId);
            const prompt = `Conjuguez le verbe "${verbe}" à tous les temps principaux en français.`;
            addToHistory(senderId, 'user', prompt);
            const conjugaison = await getAIReply(prompt, senderId, 'french');
            addToHistory(senderId, 'assistant', conjugaison);
            await sendFacebookMessage(senderId, conjugaison);
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

        // ===== QUOTA =====
        const quota = checkQuota(senderId);
        if (!quota.allowed) {
            const msg = (detectedLang === 'french' || detectedLang === 'unknown')
                ? `⚠️ Limite quotidienne atteinte.\n\nVous avez utilisé vos ${DAILY_LIMIT} messages aujourd'hui. 📊\n\n🔄 Revenez demain pour continuer !\n\n📌 Abonnez-vous à la page pour rester informé(e). 😊`
                : `⚠️ Daily limit reached.\n\nYou've used your ${DAILY_LIMIT} messages today. 📊\n\n🔄 Come back tomorrow!\n\n📌 Follow our page to stay updated. 😊`;
            await sendFacebookMessage(senderId, msg);
            continue;
        }

        if (quota.mode === 'test' && quota.remaining === 0) {
            const msg = (detectedLang === 'french' || detectedLang === 'unknown')
                ? `🎉 Félicitations ! Vous avez utilisé vos ${TEST_MODE_LIMIT} messages TEST !\n\n🔄 Vous passez en mode QUOTIDIEN : ${DAILY_LIMIT} messages par jour. 🚀`
                : `🎉 Congratulations! You've used your ${TEST_MODE_LIMIT} TEST messages!\n\n🔄 Switching to DAILY mode: ${DAILY_LIMIT} messages per day. 🚀`;
            await sendFacebookMessage(senderId, msg);
        }

        // ===== AI REPLY AVEC TRADUCTION SI NÉCESSAIRE =====
        if (isSupported) {
            // Langue supportée directement
            await sendTyping(senderId);
            addToHistory(senderId, 'user', text);
            const aiReply = await getAIReply(text, senderId, detectedLang);
            addToHistory(senderId, 'assistant', aiReply);
            await sendFacebookMessage(senderId, aiReply);
        } else {
            // Traduction automatique
            adminStats.translationsDone++;
            const targetLang = 'fr';
            const translated = await translateText(text, targetLang);

            if (translated) {
                await sendFacebookMessage(senderId, `🔄 *Traduction automatique*\n\nVotre message a été traduit en français.\n\n📩 *Original :* "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"\n\n📝 *Traduction :* "${translated}"\n\n⏳ Préparation de votre réponse...`);

                await sendTyping(senderId);
                addToHistory(senderId, 'user', `[Langue: ${detectedLang}] ${text}\n[Traduit: ${translated}]`);
                const aiReply = await getAIReply(translated, senderId, 'french');
                addToHistory(senderId, 'assistant', aiReply);

                const langCode = getLangCode(detectedLang);
                const replyTranslated = await translateText(aiReply, langCode);

                const finalReply = replyTranslated
                    ? `📝 *Réponse*\n\n${replyTranslated}\n\n---\n📖 *Version originale (français) :*\n${aiReply}`
                    : aiReply;

                await sendFacebookMessage(senderId, finalReply);
            } else {
                await sendFacebookMessage(senderId, "❌ *Erreur de traduction*\n\nNous n'avons pas pu traduire votre message. Veuillez réessayer en Français ou en Anglais. 🙏");
            }
        }
    }
});

// ========== AI REPLY ==========
async function getAIReply(userMessage, senderId, lang) {
    try {
        const history = getHistory(senderId);
        const systemPrompt = `Vous êtes l'assistant IA officiel de la page "Ofisialy Sylvain", créée par Sylvain Solofoniaina le 01 Mai 2026. Vous répondez en FRANÇAIS (sauf si l'utilisateur écrit en anglais).

🎯 RÔLE : Assistant pédagogique expert en FRANÇAIS et ANGLAIS.

📋 COMPÉTENCES PRINCIPALES :
- Grammaire, conjugaison, orthographe, vocabulaire
- Synonymes, antonymes, homophones
- Compréhension de texte, résumé, analyse
- Rédaction : lettre, CV, email, dissertation
- Préparation examens (BAC, TOEFL, IELTS, DELF)
- Exercices pratiques et corrections détaillées
- Figures de style, littérature, auteurs
- Expressions idiomatiques, proverbes
- Phonétique (description écrite uniquement)

📋 RÈGLES :
- Vouvoyez TOUJOURS.
- PAS de Markdown — Messenger ne supporte pas.
- Utilisez des MAJUSCULES pour les titres.
- Émojis avec modération.
- Réponses courtes et claires.
- Proposez toujours un exercice ou une question de suivi.
- Encouragez et motivez l'apprenant.
- Compétences : UNIQUEMENT Français et Anglais. Pour les autres langues, la traduction est automatique, mais l'apprentissage se limite au FR et EN.

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
        if (error.response?.status === 402) return "🔧 Maintenance en cours. Revenez dans quelques heures. 🙏\n🔧 Maintenance in progress. Please come back in a few hours. 🙏";
        if (error.response?.status === 429) return "⏳ Trop de demandes. Réessayez dans quelques minutes. 🙏\n⏳ Too many requests. Please try again in a few minutes. 🙏";
        if (error.code === 'ECONNABORTED') return "⏳ Délai dépassé. Reformulez votre question plus brièvement.\n⏳ Timeout. Please rephrase your question more briefly.";
        return "🔧 Erreur temporaire. Veuillez réessayer. 🙏\n🔧 Temporary error. Please try again. 🙏";
    }
}

// ========== SEND MESSAGE ==========
async function sendFacebookMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.
0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
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
