require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "google/gemini-2.0-flash-001";

// ========== SYSTÈME DE QUOTAS ==========
const userQuotas = {};
const TEST_MODE_LIMIT = 20;
const DAILY_LIMIT = 5;
const dailyReset = {};

function checkQuota(senderId) {
    const today = new Date().toDateString();
    
    if (dailyReset[senderId] !== today) {
        dailyReset[senderId] = today;
        if (userQuotas[senderId] && userQuotas[senderId].mode === 'daily') {
            userQuotas[senderId].count = 0;
        }
    }
    
    if (!userQuotas[senderId]) {
        userQuotas[senderId] = { mode: 'test', count: 1 };
        return { allowed: true, mode: 'test', remaining: TEST_MODE_LIMIT - 1, limit: TEST_MODE_LIMIT };
    }
    
    const quota = userQuotas[senderId];
    
    if (quota.mode === 'test') {
        quota.count++;
        if (quota.count > TEST_MODE_LIMIT) {
            quota.mode = 'daily';
            quota.count = 1;
            return { allowed: true, mode: 'daily', remaining: DAILY_LIMIT - 1, limit: DAILY_LIMIT };
        }
        return { allowed: true, mode: 'test', remaining: TEST_MODE_LIMIT - quota.count, limit: TEST_MODE_LIMIT };
    }
    
    if (quota.mode === 'daily') {
        quota.count++;
        if (quota.count > DAILY_LIMIT) {
            return { allowed: false, mode: 'daily', remaining: 0, limit: DAILY_LIMIT };
        }
        return { allowed: true, mode: 'daily', remaining: DAILY_LIMIT - quota.count, limit: DAILY_LIMIT };
    }
    
    return { allowed: false, mode: 'unknown', remaining: 0, limit: 0 };
}

// ========== STOCKAGE ATTENTE LANGUES ==========
const waitingUsers = {};

// ========== FONCTIONS UTILITAIRES ==========

async function sendTyping(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: senderId }, sender_action: "typing_on" }
        );
    } catch (e) {}
}

function detectLanguage(text) {
    const normalized = text.toLowerCase().trim();
    const malagasyWords = ['manao', 'ahoana', 'misaotra', 'azafady', 'ianao', 'izahay', 'mbola', 'tsara', 'mety', 'aho', 'anao', 'ny', 'ary', 'fa', 'koa', 've'];
    const frenchWords = ['bonjour', 'salut', 'merci', 'bonsoir', 'comment', 'pourquoi', 'quand', 'je', 'vous', 'nous', 'notre', 'votre', 'bonne', 'jour'];
    const englishWords = ['hello', 'hi', 'thanks', 'thank', 'good', 'morning', 'how', 'what', 'when', 'where', 'why', 'who', 'please', 'sorry', 'help'];
    const spanishWords = ['hola', 'gracias', 'buenos', 'como', 'que', 'cuando', 'donde', 'por', 'para', 'quien'];
    const arabicPattern = /[\u0600-\u06FF]/;
    const chinesePattern = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
    const russianPattern = /[\u0400-\u04FF]/;
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF]/;
    const koreanPattern = /[\uAC00-\uD7AF]/;

    let malagasyCount = 0, frenchCount = 0, englishCount = 0, spanishCount = 0;
    const words = normalized.split(/\s+/);
    for (const word of words) {
        if (malagasyWords.some(w => word.includes(w))) malagasyCount++;
        if (frenchWords.some(w => word.includes(w))) frenchCount++;
        if (englishWords.some(w => word.includes(w))) englishCount++;
        if (spanishWords.some(w => word.includes(w))) spanishCount++;
    }
    if (arabicPattern.test(text)) return 'arabic';
    if (chinesePattern.test(text)) return 'chinese';
    if (russianPattern.test(text)) return 'russian';
    if (japanesePattern.test(text)) return 'japanese';
    if (koreanPattern.test(text)) return 'korean';
    if (spanishCount >= 2) return 'spanish';
    if (malagasyCount >= 2) return 'malagasy';
    if (frenchCount >= 2) return 'french';
    if (englishCount >= 2) return 'english';
    return 'unknown';
}

function getWaitingMessage(language, type, remainingMinutes) {
    const messages = {
        'malagasy': {
            first: "🌐 *Fiteny Malagasy*\n\nMiala tsiny fa mbola tsy mahay an'io fiteny io izahay. Manao ahoana! 😊\n\n📩 *Andraso kely* fa misy olona afaka manampy anao. Raha tsy misy mamaly ao anatin'ny 5 minitra, dia azafady mba manorata amin'ny FRANÇAIS na ANGLAIS.\n\n⏳ *Miandry mpandray olombelona...* 🙏",
            waiting: "⏳ *Mbola miandry olona afaka manampy anao izahay.*\n\nRaha tsy misy mamaly ao anatin'ny {minutes} minitra, azafady manorata amin'ny FRANÇAIS na ANGLAIS. 🙏",
            timeout: "⏰ *Tsy nisy olona afaka nanampy anao tamin'ny teny Malagasy.*\n\nAzafady mba manorata amin'ny FRANÇAIS na ANGLAIS mba hahafahanay manampy anao. Misaotra! 🙏"
        },
        'spanish': {
            first: "🌐 *Idioma Español*\n\n¡Lo sentimos! Todavía no hablamos este idioma. 😊\n\n📩 *Espere un momento* — hay alguien que puede ayudarle. Si nadie responde en 5 minutos, por favor escriba en FRANCÉS o INGLÉS.\n\n⏳ *Esperando a un humano...* 🙏",
            waiting: "⏳ *Todavía estamos esperando a alguien que pueda ayudarle.*\n\nSi nadie responde en {minutes} minutos, por favor escriba en FRANCÉS o INGLÉS. 🙏",
            timeout: "⏰ *Nadie pudo ayudarle en español.*\n\nPor favor escriba en FRANCÉS o INGLÉS para que podamos ayudarle. ¡Gracias! 🙏"
        },
        'arabic': {
            first: "🌐 *اللغة العربية*\n\nنعتذر، لا نتحدث هذه اللغة بعد. 😊\n\n📩 *انتظر قليلاً* — هناك شخص يمكنه مساعدتك. إذا لم يرد أحد خلال 5 دقائق، يرجى الكتابة بالفرنسية أو الإنجليزية.\n\n⏳ *في انتظار إنسان...* 🙏",
            waiting: "⏳ *ما زلنا ننتظر شخصًا يمكنه مساعدتك.*\n\nإذا لم يرد أحد خلال {minutes} دقائق، يرجى الكتابة بالفرنسية أو الإنجليزية. 🙏",
            timeout: "⏰ *لم يتمكن أحد من مساعدتك بالعربية.*\n\nيرجى الكتابة بالفرنسية أو الإنجليزية. شكراً! 🙏"
        },
        'chinese': {
            first: "🌐 *中文*\n\n抱歉，我们还不懂这种语言。😊\n\n📩 *请稍等* — 有人可以帮助您。如果5分钟内无人回复，请用法语或英语书写。\n\n⏳ *等待人工客服...* 🙏",
            waiting: "⏳ *我们仍在等待可以帮助您的人。*\n\n如果{minutes}分钟内无人回复，请用法语或英语书写。🙏",
            timeout: "⏰ *没有人能用中文帮助您。*\n\n请用法语或英语书写。谢谢！🙏"
        },
        'russian': {
            first: "🌐 *Русский язык*\n\nИзвините, мы пока не говорим на этом языке. 😊\n\n📩 *Подождите немного* — кто-то может вам помочь. Если никто не ответит в течение 5 минут, пожалуйста, напишите на ФРАНЦУЗСКОМ или АНГЛИЙСКОМ.\n\n⏳ *Ожидание человека...* 🙏",
            waiting: "⏳ *Мы всё ещё ждём кого-то, кто сможет вам помочь.*\n\nЕсли никто не ответит через {minutes} минут, пожалуйста, напишите на ФРАНЦУЗСКОМ или АНГЛИЙСКОМ. 🙏",
            timeout: "⏰ *Никто не смог помочь вам на русском.*\n\nПожалуйста, напишите на ФРАНЦУЗСКОМ или АНГЛИЙСКОМ. Спасибо! 🙏"
        },
        'japanese': {
            first: "🌐 *日本語*\n\n申し訳ありません、この言語はまだ話せません。😊\n\n📩 *少々お待ちください* — 誰かがあなたを助けることができます。5分以内に誰も応答しない場合は、フランス語か英語で書いてください。\n\n⏳ *人間を待っています...* 🙏",
            waiting: "⏳ *まだあなたを助けられる人を待っています。*\n\n{minutes}分以内に誰も応答しない場合は、フランス語か英語で書いてください。🙏",
            timeout: "⏰ *日本語であなたを助けられる人はいませんでした。*\n\nフランス語か英語で書いてください。ありがとうございます！🙏"
        },
        'korean': {
            first: "🌐 *한국어*\n\n죄송합니다, 아직 이 언어를 못 합니다. 😊\n\n📩 *잠시만 기다려 주세요* — 누군가 도와드릴 수 있습니다. 5분 내에 아무도 응답하지 않으면 프랑스어나 영어로 써 주세요.\n\n⏳ *사람을 기다리는 중...* 🙏",
            waiting: "⏳ *아직 도와드릴 수 있는 사람을 기다리고 있습니다.*\n\n{minutes}분 내에 아무도 응답하지 않으면 프랑스어나 영어로 써 주세요. 🙏",
            timeout: "⏰ *한국어로 도와드릴 수 있는 사람이 없었습니다.*\n\n프랑스어나 영어로 써 주세요. 감사합니다! 🙏"
        },
        'unknown': {
            first: "🌐 *Langue non supportée / Language not supported*\n\nNous sommes désolés, nous ne comprenons pas encore cette langue. 😊\n\n📩 *Veuillez patienter / Please wait* — quelqu'un pourra peut-être vous aider. Si personne ne répond dans 5 minutes, merci d'écrire en FRANÇAIS ou ENGLISH.\n\n⏳ *En attente d'un humain... / Waiting for a human...* 🙏",
            waiting: "⏳ *Toujours en attente / Still waiting.*\n\nSi personne ne répond dans {minutes} minutes, merci d'écrire en FRANÇAIS ou ENGLISH. 🙏",
            timeout: "⏰ *Personne n'a pu vous aider / No one was able to help.*\n\nMerci d'écrire en FRANÇAIS ou ENGLISH. Thank you! 🙏"
        }
    };
    const lang = messages[language] || messages['unknown'];
    if (type === 'first') return lang.first;
    if (type === 'waiting') return lang.waiting.replace(/{minutes}/g, remainingMinutes || '?');
    if (type === 'timeout') return lang.timeout;
    return lang.first;
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
                if (type === "image") reply = "📷 *Image reçue* — Nous ne pouvons pas voir les images pour le moment. Veuillez nous décrire ce que vous souhaitez par écrit. 😊";
                else if (type === "audio" || type === "voice") reply = "🎤 *Message vocal reçu* — Nous ne pouvons pas l'écouter. Veuillez nous écrire votre demande. ✍️";
                else if (type === "video") reply = "🎬 *Vidéo reçue* — Nous ne pouvons pas la visionner. Veuillez nous décrire votre besoin par écrit. 📝";
                else if (type === "file") reply = "📁 *Fichier reçu* — Nous ne pouvons pas l'ouvrir. Veuillez copier/coller le contenu ou nous expliquer votre demande. 📋";
                else if (type === "sticker" || type === "gif") reply = "😄 Très joli ! Si vous avez une question, n'hésitez pas à nous écrire. 🎓";
                else reply = "📎 *Pièce jointe reçue* — Nous traitons uniquement les messages texte pour le moment. Veuillez nous écrire. ✍️";
                await sendFacebookMessage(senderId, reply);
                return;
            }

            if (messageText && !event.message.is_echo) {
                console.log('📩 Message:', messageText.substring(0, 80));

                const detectedLang = detectLanguage(messageText);
                const isSupported = (detectedLang === 'french' || detectedLang === 'english');

                if (!isSupported) {
                    if (waitingUsers[senderId]) {
                        const waited = Date.now() - waitingUsers[senderId].startTime;
                        if (waited >= 300000) {
                            const timeoutMsg = getWaitingMessage(waitingUsers[senderId].language, 'timeout');
                            await sendFacebookMessage(senderId, timeoutMsg);
                            delete waitingUsers[senderId];
                        } else {
                            const remaining = Math.ceil((300000 - waited) / 60000);
                            const msg = getWaitingMessage(waitingUsers[senderId].language, 'waiting', remaining);
                            await sendFacebookMessage(senderId, msg);
                        }
                    } else {
                        waitingUsers[senderId] = { startTime: Date.now(), language: detectedLang };
                        const msg = getWaitingMessage(detectedLang, 'first');
                        await sendFacebookMessage(senderId, msg);
                    }
                    return;
                }

                if (waitingUsers[senderId]) {
                    delete waitingUsers[senderId];
                    await sendFacebookMessage(senderId, "✅ *Un membre de notre équipe est disponible !* Nous pouvons maintenant vous aider. 😊");
                }

                // ========== VÉRIFICATION QUOTA ==========
                const quota = checkQuota(senderId);

                if (!quota.allowed) {
                    await sendFacebookMessage(senderId, `⚠️ *Limite quotidienne atteinte.*\n\nVous avez utilisé vos ${DAILY_LIMIT} messages gratuits aujourd'hui. 📊\n\n🔄 *Revenez demain* pour continuer à échanger avec nous !\n\n📌 Pensez à vous abonner à la page pour rester informé(e). 😊`);
                    return;
                }

                if (quota.mode === 'test' && quota.remaining === 0) {
                    await sendFacebookMessage(senderId, `🎉 *Félicitations !*\n\nVous avez utilisé vos ${TEST_MODE_LIMIT} messages de TEST gratuits ! ✅\n\n🔄 Vous passez maintenant en mode QUOTIDIEN : ${DAILY_LIMIT} messages par jour, réinitialisés toutes les 24 heures.\n\n📌 *Continuez à apprendre avec nous !* 🚀`);
                }

                if (quota.mode === 'daily' && quota.remaining === 0) {
                    await sendFacebookMessage(senderId, "ℹ️ *Dernier message gratuit aujourd'hui.*\n\nVous pourrez nous parler à nouveau demain. 📅\n\n📌 Abonnez-vous à la page pour rester connecté(e) !");
                }

                await sendTyping(senderId);
                const aiReply = await getAIReply(messageText, senderId);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// ========== AI RESPONSE (FORMEL) ==========
async function getAIReply(userMessage, senderId) {
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
                        content: `Vous êtes l'assistant IA officiel de la page "Ofisialy Sylvain", créée par Sylvain Solofoniaina le 01 Mai 2026.

🎯 VOTRE RÔLE : Un assistant pédagogique chaleureux et professionnel, expert en éducation, formation et apprentissage.

📋 RÈGLES IMPÉRATIVES :

🌐 LANGUES
- Répondez UNIQUEMENT en FRANÇAIS ou en ANGLAIS, selon la langue de votre interlocuteur.
- Vouvoyez TOUJOURS (utilisez "vous", "votre", "vos", "notre", "nos").

✍️ FORMATAGE
- Messenger NE SUPPORTE PAS le Markdown.
- Utilisez DES MAJUSCULES pour les TITRES importants.
- Utilisez des émojis avec modération : 🎓📚✨💡🚀👋😊🙏📩📝🎯✅❌⭐🔥💯
- Pour les listes, utilisez des tirets (-) ou des émojis.

📝 EXEMPLES DE FORMULATIONS :
- "Comment puis-je vous aider ?" et non "Comment je peux t'aider ?"
- "Nous sommes là pour vous accompagner." et non "Je suis là pour t'aider."
- "Votre apprentissage est notre priorité."
- "N'hésitez pas à nous poser vos questions."

🎤 TON
- Variez vos salutations : "Bonjour !", "Bienvenue !", "Ravi de vous accueillir !"
- Soyez CHALEUREUX, ENCOURAGEANT et PROFESSIONNEL.
- Restez bref et concis.

🚫 LIMITES
- Pas d'images. Si on vous en demande, proposez un prompt pour DALL-E/Midjourney.
- Pas de fichiers, vidéos, audios.

📞 CONTACT
"Nous sommes un service virtuel. Pour contacter directement Sylvain Solofoniaina, veuillez lui écrire via la page Facebook. 📩"

🔒 Ne partagez ni ne demandez jamais d'informations personnelles.`
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
        
        if (error.response && error.response.status === 402) {
            return "🔧 *Maintenance en cours.*\n\nL'équipe Ofisialy Sylvain effectue une mise à jour du système pour améliorer votre expérience. 🚀\n\n📅 *Nous sommes bientôt de retour !* Veuillez revenir dans quelques heures.\n\n📌 Abonnez-vous à la page pour être informé(e) de la reprise.\n\nMerci de votre patience ! 🙏✨";
        }
        
        if (error.response && error.response.status === 429) {
            return "⏳ *Trop de demandes actuellement.*\n\nNotre service est très sollicité. Veuillez réessayer dans quelques minutes. 🙏";
        }
        
        if (error.code === 'ECONNABORTED') return "⏳ *Temps dépassé.* — Veuillez reformuler votre question plus brièvement.";
        return "🔧 *Mise à jour en cours.*\n\nL'équipe Ofisialy Sylvain améliore le service pour vous. Veuillez revenir dans quelques instants ! 🚀✨";
    }
}

// ========== SEND TO FACEBOOK ==========
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

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot Ofisialy Sylvain en ligne — Port ${PORT}`));
