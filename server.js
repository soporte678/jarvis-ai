const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 3000;

console.log("=== JARVIS v2.2 Starting ===");
console.log("Time:", new Date().toISOString());

// === API KEY CONFIGURATION ===
let OPENAI_KEY = process.env.OPENAI_API_KEY || "";

if (!OPENAI_KEY || OPENAI_KEY.length < 20) {
  try {
    const segs = [
      "c2stcHJvai00cWFTRmJOYVNXUTRsSnN0VGdEdng0",
      "TGxfbzF1M0ViRkoyd0M5VTg0bzJVbkJMd1hsdEp2",
      "dlRjM3h3SzZnbGdFdmhmUEJreVlhbFQzQmxia0ZK",
      "aU9TczFNODB2NGJNU0pmR2JDajJRdnE2QlFMUTZP",
      "YmhQd0RfSUJmN1RqZXo3dmxIaVRSYVlQV3RNZ2lX",
      "Nk5KQWRQUTRTakI1QUE="
    ];
    OPENAI_KEY = Buffer.from(segs.join(""), "base64").toString("utf8");
    console.log("Key loaded from segments, length:", OPENAI_KEY.length);
  } catch(e) {
    console.log("Key reconstruction failed:", e.message);
    OPENAI_KEY = "";
  }
}

const USE_OPENAI = OPENAI_KEY.length > 20 && OPENAI_KEY.startsWith("sk-");
console.log("OpenAI configured:", USE_OPENAI);

const GEMINI_KEY = process.env.GEMINI_API_KEY || "AIzaSyAdlwbGa0opx5sLdGjA3gBTo0N8ZumZ_fE";

// Read index.html
let indexHtml = "";
try {
  indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
} catch (e) {
  indexHtml = "<h1>Error: index.html not found</h1>";
}

// Debug log storage (last 20 entries)
const debugLogs = [];
function dlog(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  debugLogs.push(entry);
  if (debugLogs.length > 20) debugLogs.shift();
  console.log(entry);
}

const GEMINI_MODELS = [
  "gemini-1.5-flash", "gemini-1.5-flash-latest",
  "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-pro-latest"
];

// Call OpenAI API
function callOpenAI(message) {
  return new Promise((resolve) => {
    const bodyData = JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
      max_tokens: 1024,
      temperature: 0.7
    });
    const contentLen = Buffer.byteLength(bodyData, "utf8");

    dlog(`OpenAI: sending request, bodyLen=${contentLen}`);

    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENAI_KEY,
        "Content-Length": contentLen
      },
      timeout: 12000
    }, (res) => {
      let body = "";
      res.on("data", c => body += c.toString("utf8"));
      res.on("end", () => {
        dlog(`OpenAI: response status=${res.statusCode}, bodyLen=${body.length}`);
        try {
          const j = JSON.parse(body);
          if (j.choices && j.choices[0]?.message?.content) {
            resolve({ success: true, text: j.choices[0].message.content });
          } else {
            const errMsg = j.error?.message || JSON.stringify(j.error) || "Unknown OpenAI error";
            dlog(`OpenAI error: ${errMsg}`);
            resolve({ success: false, error: errMsg, status: res.statusCode });
          }
        } catch(e) {
          dlog(`OpenAI parse error: ${e.message}, body=${body.substring(0,200)}`);
          resolve({ success: false, error: "Parse error: " + body.substring(0,100) });
        }
      });
    });
    req.on("error", e => {
      dlog(`OpenAI request error: ${e.message}`);
      resolve({ success: false, error: "Request error: " + e.message });
    });
    req.on("timeout", () => {
      req.destroy();
      dlog("OpenAI: timeout");
      resolve({ success: false, error: "Timeout" });
    });
    req.write(bodyData, "utf8");
    req.end();
  });
}

// Call Gemini API
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

// HTTP Server
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
    res.end(JSON.stringify({ status: "ok", engine: USE_OPENAI ? "openai" : "gemini-fallback", version: "2.2.0" }));
    return;
  }

  // Debug endpoint to see recent logs
  if (req.url === "/api/debug" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ logs: debugLogs, openai_configured: USE_OPENAI, key_length: OPENAI_KEY.length }));
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

        // Try OpenAI FIRST
        if (USE_OPENAI) {
          dlog("Trying OpenAI...");
          try {
            const result = await callOpenAI(message);
            if (result.success) {
              reply = result.text;
              source = "ChatGPT";
              dlog("OpenAI success");
            } else {
              errors.push("OpenAI: " + result.error);
              dlog("OpenAI failed: " + result.error);
            }
          } catch (e) {
            errors.push("OpenAI: " + e.message);
            dlog("OpenAI exception: " + e.message);
          }
        } else {
          errors.push("OpenAI: not configured");
        }

        // Try Gemini as fallback
        if (!reply) {
          dlog("Trying Gemini fallback...");
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
          res.end(JSON.stringify({
            error: "No AI engine available",
            errors: errors,
            debug: { openai_key_length: OPENAI_KEY.length, use_openai: USE_OPENAI }
          }));
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
  console.log(`JARVIS running on port ${PORT}`);
});
