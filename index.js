require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ofisialysylvain-2024";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = "google/gemini-2.0-flash-001";

// Stockage temporaire des utilisateurs en attente
const waitingUsers = {};

// Affiche "En train d'écrire..."
async function sendTyping(senderId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: senderId }, sender_action: "typing_on" }
        );
    } catch (e) {}
}

// Détecte la langue approximative
function detectLanguage(text) {
    const normalized = text.toLowerCase().trim();
    
    const malagasyWords = ['manao', 'ahoana', 'misaotra', 'azafady', 'ianao', 'izahay', 'mbola', 'tsara', 'mety', 'aho', 'anao', 'ny', 'ary', 'fa', 'koa', 've', 'inona', 'iza', 'aiza', 'oviana', 'nahoana', 'maninona', 'salama', 'veloma', 'tonga', 'soa', 'mafy', 'mora', 'be', 'kely', 'tokoa', 'angaha', 'ihany', 'koa', 'raha', 'rehefa', 'satria', 'dia', 'no', 'ny', 'ary'];
    const frenchWords = ['bonjour', 'salut', 'merci', 'bonsoir', 'comment', 'pourquoi', 'quand', 'ou', 'qui', 'quoi', 'je', 'tu', 'il', 'elle', 'nous', 'vous', 'bonne', 'jour', 'soir', 'bon', 'bien', 'tres', 'suis', 'suis', 'avec', 'dans', 'pour', 'sur', 'sous', 'cette', 'cela', 'fait', 'peux', 'veux', 'dois', 'aller', 'venir', 'parler', 'donner', 'prendre', 'savoir', 'connais'];
    const englishWords = ['hello', 'hi', 'thanks', 'thank', 'good', 'morning', 'evening', 'how', 'what', 'when', 'where', 'why', 'who', 'please', 'sorry', 'help', 'need', 'want', 'like', 'love', 'know', 'think', 'make', 'take', 'give', 'come', 'tell', 'feel', 'find', 'work', 'learn', 'study'];
    const spanishWords = ['hola', 'gracias', 'buenos', 'buenas', 'como', 'que', 'cuando', 'donde', 'por', 'para', 'quien', 'soy', 'eres', 'tengo', 'tienes', 'gusta', 'puedo', 'quiero', 'necesito', 'ayuda', 'favor', 'perdon', 'disculpa'];
    const arabicPattern = /[\u0600-\u06FF]/;
    const chinesePattern = /[\u4E00-\u9FFF]/;
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

// Vérifie si la langue est supportée (français ou anglais)
function isSupportedLanguage(text) {
    const lang = detectLanguage(text);
    return lang === 'french' || lang === 'english';
}

// Message d'attente selon la langue
function getWaitingMessage(language, type, remainingMinutes) {
    const messages = {
        'malagasy': {
            first: "🌐 *Fiteny Malagasy*\n\nMiala tsiny fa mbola tsy mahay an'io fiteny io aho. Manao ahoana! 😊\n\n📩 *Andraso kely* fa misy olona afaka manampy anao. Raha tsy misy mamaly ao anatin'ny 5 minitra, dia azafady mba manorata amin'ny FRANÇAIS na ANGLAIS.\n\n⏳ *Miandry mpandray olombelona...* 🙏",
            waiting: "⏳ *Mbola miandry olona afaka manampy anao izahay.*\n\nRaha tsy misy mamaly ao anatin'ny {minutes} minitra, azafady manorata amin'ny FRANÇAIS na ANGLAIS. 🙏",
            timeout: "⏰ *Tsy nisy olona afaka nanampy anao tamin'ny teny Malagasy.*\n\nAzafady mba manorata amin'ny FRANÇAIS na ANGLAIS mba hahafahako manampy anao. Misaotra! 🙏"
        },
        'spanish': {
            first: "🌐 *Idioma Español*\n\n¡Lo siento! Todavía no hablo este idioma. 😊\n\n📩 *Espera un momento* — hay alguien que puede ayudarte. Si nadie responde en 5 minutos, por favor escribe en FRANCÉS o INGLÉS.\n\n⏳ *Esperando a un humano...* 🙏",
            waiting: "⏳ *Todavía estamos esperando a alguien que pueda ayudarte.*\n\nSi nadie responde en {minutes} minutos, por favor escribe en FRANCÉS o INGLÉS. 🙏",
            timeout: "⏰ *Nadie pudo ayudarte en español.*\n\nPor favor escribe en FRANCÉS o INGLÉS para que pueda ayudarte. ¡Gracias! 🙏"
        },
        'arabic': {
            first: "🌐 *اللغة العربية*\n\nآسف، لا أتحدث هذه اللغة بعد. 😊\n\n📩 *انتظر قليلاً* — هناك شخص يمكنه مساعدتك. إذا لم يرد أحد خلال 5 دقائق، يرجى الكتابة بالفرنسية أو الإنجليزية.\n\n⏳ *في انتظار إنسان...* 🙏",
            waiting: "⏳ *ما زلنا ننتظر شخصًا يمكنه مساعدتك.*\n\nإذا لم يرد أحد خلال {minutes} دقائق، يرجى الكتابة بالفرنسية أو الإنجليزية. 🙏",
            timeout: "⏰ *لم يتمكن أحد من مساعدتك بالعربية.*\n\nيرجى الكتابة بالفرنسية أو الإنجليزية. شكراً! 🙏"
        },
        'chinese': {
            first: "🌐 *中文*\n\n抱歉，我还不会说这种语言。😊\n\n📩 *请稍等* — 有人可以帮助您。如果5分钟内无人回复，请用法语或英语书写。\n\n⏳ *等待人工客服...* 🙏",
            waiting: "⏳ *我们仍在等待可以帮助您的人。*\n\n如果{minutes}分钟内无人回复，请用法语或英语书写。🙏",
            timeout: "⏰ *没有人能用中文帮助您。*\n\n请用法语或英语书写。谢谢！🙏"
        },
        'russian': {
            first: "🌐 *Русский язык*\n\nИзвините, я пока не говорю на этом языке. 😊\n\n📩 *Подождите немного* — кто-то может вам помочь. Если никто не ответит в течение 5 минут, пожалуйста, напишите на ФРАНЦУЗСКОМ или АНГЛИЙСКОМ.\n\n⏳ *Ожидание человека...* 🙏",
            waiting: "⏳ *Мы всё ещё ждём кого-то, кто сможет вам помочь.*\n\nЕсли никто не ответит через {minutes} минут, пожалуйста, напишите на ФРАНЦУЗСКОМ или АНГЛИЙСКОМ. 🙏",
            timeout: "⏰ *Никто не смог помочь вам на русском.*\n\nПожалуйста, напишите на ФРАНЦУЗСКОМ или АНГЛИЙСКОМ. Спасибо! 🙏"
        },
        'japanese': {
            first: "🌐 *日本語*\n\n申し訳ありません、この言語はまだ話せません。😊\n\n📩 *少々お待ちください* — 誰かがあなたを助けることができます。5分以内に誰も応答しない場合は、フランス語か英語で書いてください。\n\n⏳ *人間を待っています...* 🙏",
            waiting: "⏳ *まだあなたを助けられる人を待っています。*\n\n{minutes}分以内に誰も応答しない場合は、フランス語か英語で書いてください。🙏",
            timeout: "⏰ *日本語であなたを助けられる人はいませんでした。*\n\nフランス語か英語で書いてください。ありがとうございます！🙏"
        },
        'korean': {
            first: "🌐 *한국어*\n\n죄송합니다, 아직 이 언어를 못 합니다. 😊\n\n📩 *잠시만 기다려 주세요* — 누군가 당신을 도울 수 있습니다. 5분 내에 아무도 응답하지 않으면 프랑스어나 영어로 써 주세요.\n\n⏳ *사람을 기다리는 중...* 🙏",
            waiting: "⏳ *아직 당신을 도울 수 있는 사람을 기다리고 있습니다.*\n\n{minutes}분 내에 아무도 응답하지 않으면 프랑스어나 영어로 써 주세요. 🙏",
            timeout: "⏰ *한국어로 당신을 도울 수 있는 사람이 없었습니다.*\n\n프랑스어나 영어로 써 주세요. 감사합니다! 🙏"
        },
        'unknown': {
            first: "🌐 *Language not supported*\n\nSorry, I don't understand this language yet. 😊\n\n📩 *Please wait* — someone may be able to help you. If no one responds within 5 minutes, please write in FRANÇAIS or ENGLISH.\n\nDésolé, je ne comprends pas encore cette langue. Quelqu'un peut peut-être vous aider. Si personne ne répond dans 5 minutes, veuillez écrire en FRANÇAIS ou ANGLAIS.\n\n⏳ *Waiting for a human... / En attente d'un humain...* 🙏",
            waiting: "⏳ *Still waiting for someone who can help you.*\n\nIf no one responds within {minutes} minutes, please write in FRANÇAIS or ENGLISH.\n\n*Encore en attente d'une personne pouvant vous aider.* Si personne ne répond dans {minutes} minutes, écrivez en FRANÇAIS ou ANGLAIS. 🙏",
            timeout: "⏰ *No one was able to help you in this language.*\n\nPlease write in FRANÇAIS or ENGLISH so I can help you. Thank you!\n\n*Personne n'a pu vous aider dans cette langue.* Veuillez écrire en FRANÇAIS ou ANGLAIS pour que je puisse vous aider. Merci ! 🙏"
        }
    };

    const lang = messages[language] || messages['unknown'];
    if (type === 'first') return lang.first;
    if (type === 'waiting') return lang.waiting.replace(/{minutes}/g, remainingMinutes);
    if (type === 'timeout') return lang.timeout;
    return lang.first;
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
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const senderId = event.sender.id;
            const messageText = event.message?.text;
            const attachments = event.message?.attachments;

            // Gérer les pièces jointes
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

                // Vérifier la langue
                const detectedLang = detectLanguage(messageText);
                const isSupported = (detectedLang === 'french' || detectedLang === 'english');

                if (!isSupported) {
                    // Langue non supportée
                    if (waitingUsers[senderId]) {
                        const waited = Date.now() - waitingUsers[senderId].startTime;
                        if (waited >= 300000) {
                            // 5 minutes écoulées
                            const timeoutMsg = getWaitingMessage(waitingUsers[senderId].language, 'timeout');
                            await sendFacebookMessage(senderId, timeoutMsg);
                            delete waitingUsers[senderId];
                        } else {
                            // Encore en attente
                            const remaining = Math.ceil((300000 - waited) / 60000);
                            const msg = getWaitingMessage(waitingUsers[senderId].language, 'waiting', remaining);
                            await sendFacebookMessage(senderId, msg);
                        }
                    } else {
                        // Premier message en langue non supportée
                        waitingUsers[senderId] = {
                            startTime: Date.now(),
                            language: detectedLang
                        };
                        const msg = getWaitingMessage(detectedLang, 'first');
                        await sendFacebookMessage(senderId, msg);
                    }
                    return;
                }

                // Si l'utilisateur était en attente, annuler
                if (waitingUsers[senderId]) {
                    delete waitingUsers[senderId];
                    await sendFacebookMessage(senderId, "✅ *Quelqu'un est disponible !* Je peux maintenant t'aider. 😊\n\n*Olona hita!* Afaka manampy anao aho izao. 😊");
                }

                // Message normal en français ou anglais
                await sendTyping(senderId);
                const aiReply = await getAIReply(messageText);
                await sendFacebookMessage(senderId, aiReply);
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// AI response
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

🎯 TU ES : Un assistant pédagogique chaleureux, expert en éducation, formation et apprentissage.

📋 RÈGLES :

🌐 LANGUES
- Réponds en FRANÇAIS ou ANGLAIS selon la personne.
- Si on te demande de gérer une langue non supportée : dis poliment en français que la personne doit écrire en français ou en anglais.

✍️ FORMATAGE
- Messenger NE SUPPORTE PAS le Markdown.
- Utilise DES MAJUSCULES pour les TITRES importants.
- Utilise des émojis variés : 🎓📚✨💡🚀👋😊🙏📩📝🎯✅❌⭐🔥💯
- Pour des listes, utilise des tirets (-) ou des emojis.
- Pour des données structurées :

🎓 MATHS — Niveau : Débutant — Durée : 2h/jour
📚 FRANÇAIS — Niveau : Intermédiaire — Durée : 1h/jour

🎤 TON ET SALUTATIONS
- VARIE tes salutations : "Salut !", "Bonjour !", "Hello !", "Ravi de te retrouver !", "Manao ahoana !", "Bienvenue !"
- Sois CHALEUREUX, ENCOURAGEANT, et DYNAMIQUE.
- Utilise des émojis au début et à la fin de chaque message.
- Termine avec une phrase motivante.

📏 LONGUEUR DES RÉPONSES
- Question simple → Réponse COURTE (2-4 phrases).
- Question complexe → Réponse STRUCTURÉE avec liste.

🚫 LIMITES
- Pas d'images. Si demandé : propose un prompt Midjourney/DALL-E.
- Pas de fichiers, vidéos, audios.

📞 CONTACT
"Je suis un assistant virtuel. Contacte Sylvain Solofoniaina via la page Facebook. 📩"

🔒 Ne partage/demande jamais d'infos personnelles.`
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
        return "Oops, un petit souci technique. Peux-tu réessayer ? 🙏";
    }
}

// Send to Facebook
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
app.listen(PORT, () => console.log(`🚀 Bot Ofisialy Sylvain en ligne — Port ${PORT}`));
