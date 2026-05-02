const functions = require("firebase-functions");
const axios = require("axios");

const PAGE_ACCESS_TOKEN = "EAAXLMWmZBPSwBRXEgVl83ZCg537miZBPRjZCuX4xHNxG7zFo7R1oCQV3gZBAhWBK3N3H4IoQH0qHn7rMXBgPZBZBBb0xSQZBrHqwH4EMo9aBCNYfh685b2XmNTYZBDqQfp1r6CyJyyTFJNOhRdI91vXSBpBd7Jla5QCG9LT3ONcoZBJFe1BNV1WNGw4iAP0KhgtZASKxFV7o9fOBwZDZD";
const VERIFY_TOKEN = "ofisialysylvain-2024";
const OPENROUTER_API_KEY = "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";
const AI_MODEL = "mistralai/mistral-7b-instruct:free";

exports.webhook = functions.https.onRequest(async (req, res) => {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  if (req.method === "POST") {
    const body = req.body;
    if (body.object === "page") {
      for (const entry of body.entry) {
        const event = entry.messaging[0];
        const senderId = event.sender.id;
        const messageText = event.message?.text;
        if (messageText) {
          const aiReply = await getAIReply(messageText);
          await sendFacebookMessage(senderId, aiReply);
        }
      }
    }
    return res.sendStatus(200);
  }
});

async function getAIReply(userMessage) {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: "Tu es l'assistant officiel de 'Ofisialy Sylvain', une page dédiée à la formation et à l'enseignement. Tu réponds en français ou en anglais selon la langue de la personne. Ton ton est amical, bienveillant et motivant. Tu utilises des emojis avec modération. Si tu ne connais pas une information précise, tu invites la personne à patienter ou à recontacter plus tard."
          },
          {
            role: "user",
            content: userMessage
          }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("OpenRouter error:", error.message);
    return "Désolé, une erreur s'est produite. Veuillez réessayer dans quelques instants. 🙏";
  }
}

async function sendFacebookMessage(recipientId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: recipientId },
        message: { text: text }
      }
    );
  } catch (error) {
    console.error("Facebook send error:", error.message);
  }
}