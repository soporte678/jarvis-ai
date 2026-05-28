const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 3000;
console.log("=== JARVIS v3.1 Starting ===");

// === API KEYS FROM ENV ONLY (set via Railway dashboard) ===
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "AIzaSyAdlwbGa0opx5sLdGjA3gBTo0N8ZumZ_fE";

const USE_OPENAI = OPENAI_KEY.length > 20 && OPENAI_KEY.startsWith("sk-");
const USE_GROQ = GROQ_KEY.length > 20 && GROQ_KEY.startsWith("gsk_");
console.log("OpenAI:", USE_OPENAI, "| Groq:", USE_GROQ, "| Gemini:", GEMINI_KEY.length > 10);

// Read index.html
let indexHtml = "";
try { indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8"); }
catch (e) { indexHtml = "<h1>Error: index.html not found</h1>"; }

const GEMINI_MODELS = [
  "gemini-1.5-flash", "gemini-1.5-flash-latest",
  "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-pro-latest"
];

// === API CALL FUNCTIONS ===

function apiCall(hostname, path, headers, bodyData, timeout) {
  return new Promise((resolve) => {
    const contentLen = Buffer.byteLength(bodyData, "utf8");
    const req = https.request({ hostname, path, method: "POST",
      headers: { ...headers, "Content-Length": contentLen }, timeout
    }, (res) => {
      let body = "";
      res.on("data", c => body += c.toString("utf8"));
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          if (j.choices && j.choices[0]?.message?.content) {
            resolve({ success: true, text: j.choices[0].message.content });
          } else {
            resolve({ success: false, error: j.error?.message || JSON.stringify(j.error) || "API error", status: res.statusCode });
          }
        } catch { resolve({ success: false, error: "Invalid JSON: " + body.substring(0,200) }); }
      });
    });
    req.on("error", e => resolve({ success: false, error: "Network: " + e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "Timeout" }); });
    req.write(bodyData, "utf8");
    req.end();
  });
}

function callGroq(message) {
  const body = JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: message }],
    max_tokens: 1024, temperature: 0.7
  });
  return apiCall("api.groq.com", "/openai/v1/chat/completions",
    { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY }, body, 12000);
}

function callOpenAI(message) {
  const body = JSON.stringify({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: message }],
    max_tokens: 1024, temperature: 0.7
  });
  return apiCall("api.openai.com", "/v1/chat/completions",
    { "Content-Type": "application/json", "Authorization": "Bearer " + OPENAI_KEY }, body, 12000);
}

function callGemini(model, message) {
  return new Promise((resolve) => {
    const bodyData = JSON.stringify({
      contents: [{ parts: [{ text: message }] }],
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
    res.end(JSON.stringify({
      status: "ok",
      engine: USE_GROQ ? "groq" : (USE_OPENAI ? "openai" : "none"),
      version: "3.1.0"
    }));
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
        let reply = "";
        let source = "";
        let errors = [];

        // 1) Try GROQ FIRST
        if (USE_GROQ && !reply) {
          const result = await callGroq(message);
          if (result.success) { reply = result.text; source = "JARVIS"; }
          else { errors.push("Groq: " + result.error); }
        }

        // 2) Try OpenAI as fallback
        if (!reply && USE_OPENAI) {
          const result = await callOpenAI(message);
          if (result.success) { reply = result.text; source = "ChatGPT"; }
          else { errors.push("OpenAI: " + result.error); }
        }

        // 3) Try Gemini as last fallback
        if (!reply) {
          for (const model of GEMINI_MODELS) {
            try {
              const result = await callGemini(model, message);
              if (result.success) { reply = result.text; source = "Gemini"; break; }
            } catch (e) {}
          }
          if (!reply) errors.push("Gemini: all models failed");
        }

        if (!reply) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No AI engine available. Add credits to your OpenAI account or get a free Groq key at groq.com.", errors }));
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
  console.log(`JARVIS v3.1 on port ${PORT}`);
});
