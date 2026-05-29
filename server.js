const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 3000;
console.log("=== JARVIS v4.0 Starting ===");

// === API KEYS ===
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "AIzaSyAdlwbGa0opx5sLdGjA3gBTo0N8ZumZ_fE";
const USE_OPENAI = OPENAI_KEY.length > 20 && OPENAI_KEY.startsWith("sk-");
console.log("OpenAI:", USE_OPENAI, "| Gemini:", GEMINI_KEY.length > 10);

// Read index.html
let indexHtml = "";
try { indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8"); }
catch (e) { indexHtml = "<h1>Error: index.html not found</h1>"; }

const GEMINI_MODELS = [
  "gemini-1.5-flash", "gemini-1.5-flash-latest",
  "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-pro-latest"
];

// In-memory reminders (per session - simple)
const reminders = [];
const notes = [];

// === LOCAL COMMAND HANDLER ===
// These run instantly without calling any AI API
function handleLocalCommand(msg) {
  const lower = msg.toLowerCase().trim();

  // === TIME COMMANDS ===
  if (/\b(que hora es|qué hora es|hora actual|dime la hora|hora)\b/i.test(lower)) {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const mStr = m < 10 ? '0' + m : m;
    return {
      reply: `Son las ${h12}:${mStr} ${ampm}. En formato 24 horas: ${h < 10 ? '0' + h : h}:${mStr}.`,
      source: "JARVIS"
    };
  }

  if (/\b(que dia es|qué día es|fecha actual|dime la fecha|fecha)\b/i.test(lower)) {
    const now = new Date();
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return {
      reply: `Hoy es ${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}.`,
      source: "JARVIS"
    };
  }

  // === CALCULATOR ===
  const calcMatch = lower.match(/\b(calcular|cuanto es|cuánto es|calculate)\b[\s:]*(.*)/i);
  if (calcMatch) {
    let expr = calcMatch[2] || lower.replace(/.*(?:calcular|cuanto es|cuánto es|calculate)\s*[:\s]*/, '');
    expr = expr.replace(/[^0-9+\-*/().\s^%]/g, '').replace(/\^/g, '**').trim();
    if (expr) {
      try {
        const result = Function('"use strict"; return (' + expr + ')')();
        return { reply: `El resultado de ${expr.replace(/\*\*/g, '^')} es ${result}.`, source: "JARVIS" };
      } catch { /* fall through to AI */ }
    }
  }

  // Direct math expression like "2+2" or "5 * 8"
  const directMath = lower.match(/^[\d\s+\-*/().%^]+$/);
  if (directMath && /[\d]/.test(lower) && /[+\-*/].*[\d]/.test(lower)) {
    try {
      const expr = lower.replace(/\^/g, '**');
      const result = Function('"use strict"; return (' + expr + ')')();
      return { reply: `${expr.replace(/\*\*/g, '^')} = ${result}`, source: "JARVIS" };
    } catch { /* fall through */ }
  }

  // === COIN / DICE ===
  if (/\b(tira una moneda|moneda|flip a coin|flip coin|cara o cruz)\b/i.test(lower)) {
    return { reply: `🪙 ${Math.random() < 0.5 ? 'Cara' : 'Cruz'}!`, source: "JARVIS" };
  }
  if (/\b(tira un dado|dado|roll a dice|tirar dado)\b/i.test(lower)) {
    return { reply: `🎲 ${Math.floor(Math.random() * 6) + 1}!`, source: "JARVIS" };
  }

  // === RANDOM NUMBER ===
  const numMatch = lower.match(/\b(numero aleatorio|número aleatorio|random number)\b.*?(\d+).*?(\d+)/i);
  if (numMatch) {
    const min = parseInt(numMatch[2]), max = parseInt(numMatch[3]);
    if (!isNaN(min) && !isNaN(max)) {
      const result = Math.floor(Math.random() * (max - min + 1)) + min;
      return { reply: `🎲 Número aleatorio entre ${min} y ${max}: ${result}`, source: "JARVIS" };
    }
  }

  // === GREETINGS ===
  if (/\b(hola|hello|buenos dias|buenas tardes|buenas noches|hey)\b/i.test(lower) && lower.length < 40) {
    const hour = new Date().getHours();
    let saludo = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
    return {
      reply: `${saludo}, señor. Soy JARVIS, su asistente virtual. ¿En qué puedo ayudarle?`,
      source: "JARVIS"
    };
  }

  // === JOKES ===
  if (/\b(chiste|cuenta un chiste|dime un chiste|cuentame un chiste|hazme reir)\b/i.test(lower)) {
    const chistes = [
      "¿Por qué los pájaros no usan Facebook? Porque ya tienen Twitter.",
      "¿Qué le dice una iguana a su hermana gemela? Iguanita.",
      "¿Cuál es el café más peligroso del mundo? El ex-preso.",
      "¿Qué hace una abeja en el gimnasio? Zumba.",
      "¿Por qué los esqueletos no pelean entre ellos? Porque no tienen agallas.",
      "¿Cómo se despiden los químicos? Ácido un placer.",
      "¿Qué le dice un jaguar a otro jaguar? Jaguar you.",
      "¿Por qué los programadores confunden Halloween y Navidad? Porque 31 OCT = 25 DEC."
    ];
    return { reply: chistes[Math.floor(Math.random() * chistes.length)], source: "JARVIS" };
  }

  // === REMINDERS ===
  if (/\b(recordatorio|recordame|recuérdame|recuerdame|remind me)\b/i.test(lower)) {
    const reminderText = msg.replace(/\b(recordatorio|recordame|recuérdame|recuerdame|remind me)\b/gi, '').trim();
    if (reminderText && reminderText.length > 2) {
      reminders.push({ text: reminderText, time: Date.now() });
      return { reply: `Recordatorio guardado: "${reminderText}". Tenés ${reminders.length} recordatorio${reminders.length > 1 ? 's' : ''}.`, source: "JARVIS" };
    } else {
      if (reminders.length === 0) return { reply: "No tenés recordatorios guardados.", source: "JARVIS" };
      const list = reminders.map((r, i) => `${i + 1}. ${r.text}`).join('\n');
      return { reply: `Tus recordatorios:\n${list}`, source: "JARVIS" };
    }
  }

  if (/\b(borrar recordatorio|eliminar recordatorio|borrar todos los recordatorios)\b/i.test(lower)) {
    reminders.length = 0;
    return { reply: "Todos los recordatorios han sido eliminados.", source: "JARVIS" };
  }

  // === NOTES ===
  if (/\b(nota|apunta|anota|guarda esto|note that)\b/i.test(lower)) {
    const noteText = msg.replace(/\b(nota|apunta|anota|guarda esto|note that)\b/gi, '').trim();
    if (noteText && noteText.length > 2) {
      notes.push({ text: noteText, time: Date.now() });
      return { reply: `Nota guardada. Tenés ${notes.length} nota${notes.length > 1 ? 's' : ''}.`, source: "JARVIS" };
    } else {
      if (notes.length === 0) return { reply: "No tenés notas guardadas.", source: "JARVIS" };
      const list = notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n');
      return { reply: `Tus notas:\n${list}`, source: "JARVIS" };
    }
  }

  if (/\b(mis notas|ver notas|mostrar notas)\b/i.test(lower)) {
    if (notes.length === 0) return { reply: "No tenés notas guardadas.", source: "JARVIS" };
    const list = notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n');
    return { reply: `Tus notas:\n${list}`, source: "JARVIS" };
  }

  // === WHO ARE YOU ===
  if (/\b(quien sos|quién sos|quien eres|quién eres|quien eres|quién eres|que sos|qué sos|que eres|qué eres)\b/i.test(lower)) {
    return {
      reply: "Soy JARVIS — Just A Rather Very Intelligent System. Fui diseñado para asistirle en cualquier tarea que requiera. Puedo calcular, recordar, buscar información, conversar, y mucho más. ¿En qué puedo ayudarle, señor?",
      source: "JARVIS"
    };
  }

  // === HELP ===
  if (/\b(que podes hacer|qué podés hacer|que sabes hacer|ayuda|help|comandos|como te uso|cómo te uso)\b/i.test(lower)) {
    return {
      reply: `Estos son mis comandos disponibles:\n\n🕐 Hora y fecha: "¿Qué hora es?" / "¿Qué día es?"\n🔢 Calculadora: "2+2" / "Calcular 15*8"\n🪙 Azar: "Tira una moneda" / "Tira un dado"\n😄 Chistes: "Contame un chiste"\n📝 Recordatorios: "Recordame llamar al médico"\n📋 Notas: "Anota comprar leche" / "Mis notas"\n❓ Quién soy: "¿Quién sos?"\n🌐 Preguntáme cualquier cosa y uso mi inteligencia artificial para responder.`,
      source: "JARVIS"
    };
  }

  return null; // No local command matched, use AI
}

// === API CALL FUNCTIONS ===

function callOpenAI(message) {
  return new Promise((resolve) => {
    const bodyData = JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "Sos JARVIS, un asistente virtual inteligente, servicial y con personalidad. Respondé siempre en español. Sé conciso pero completo. Tenés un tono profesional pero amigable." },
        { role: "user", content: message }
      ],
      max_tokens: 1024, temperature: 0.7
    });
    const contentLen = Buffer.byteLength(bodyData, "utf8");
    const req = https.request({
      hostname: "api.openai.com", path: "/v1/chat/completions", method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + OPENAI_KEY, "Content-Length": contentLen },
      timeout: 12000
    }, (res) => {
      let body = "";
      res.on("data", c => body += c.toString("utf8"));
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          if (j.choices && j.choices[0]?.message?.content) {
            resolve({ success: true, text: j.choices[0].message.content });
          } else {
            resolve({ success: false, error: j.error?.message || "OpenAI error" });
          }
        } catch { resolve({ success: false, error: "Invalid response" }); }
      });
    });
    req.on("error", e => resolve({ success: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "Timeout" }); });
    req.write(bodyData, "utf8");
    req.end();
  });
}

function callGemini(model, message) {
  return new Promise((resolve) => {
    const bodyData = JSON.stringify({
      contents: [{ parts: [{ text: "Actuá como JARVIS, un asistente virtual inteligente. Respondé en español de forma concisa. Pregunta: " + message }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    });
    const contentLen = Buffer.byteLength(bodyData, "utf8");
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": contentLen },
      timeout: 10000
    }, (res) => {
      let body = "";
      res.on("data", c => body += c.toString("utf8"));
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          if (j.candidates && j.candidates[0]?.content?.parts?.[0]?.text) {
            resolve({ success: true, text: j.candidates[0].content.parts[0].text });
          } else { resolve({ success: false, error: j.error?.message || "Gemini error" }); }
        } catch { resolve({ success: false, error: "Invalid response" }); }
      });
    });
    req.on("error", e => resolve({ success: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "Timeout" }); });
    req.write(bodyData, "utf8");
    req.end();
  });
}

// === HTTP SERVER ===
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(indexHtml);
    return;
  }

  if (req.url === "/api/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", engine: USE_OPENAI ? "ChatGPT" : "Gemini", version: "4.0.0" }));
    return;
  }

  if (req.url === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk.toString("utf8"));
    req.on("end", async () => {
      try {
        const json = JSON.parse(body);
        const message = json.message;
        if (!message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Message required" }));
          return;
        }

        const start = Date.now();

        // 1) Try local commands FIRST (instant, no API call)
        const localResult = handleLocalCommand(message);
        if (localResult) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ reply: localResult.reply, source: localResult.source, durationMs: Date.now() - start, local: true }));
          return;
        }

        // 2) Try OpenAI
        let reply = "";
        let source = "";
        if (USE_OPENAI) {
          const result = await callOpenAI(message);
          if (result.success) { reply = result.text; source = "ChatGPT"; }
        }

        // 3) Try Gemini as fallback
        if (!reply) {
          for (const model of GEMINI_MODELS) {
            try {
              const result = await callGemini(model, message);
              if (result.success) { reply = result.text; source = "Gemini"; break; }
            } catch (e) {}
          }
        }

        if (!reply) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No AI engine available. Verificá tu conexión o API keys." }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply, source, durationMs: Date.now() - start }));

      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`JARVIS v4.0 on port ${PORT}`);
});
