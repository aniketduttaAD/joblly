#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) {
        const key = m[1];
        const value = m[2].replace(/^["']|["']$/g, "").trim();
        if (!process.env[key]) process.env[key] = value;
      }
    }
    break;
  }
}

loadEnv();

// SITE_URL may be a JSON array like ["https://example.com"] — extract first entry
function parseSiteUrl(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed[0];
    return String(parsed);
  } catch {
    return raw;
  }
}

const baseUrl = parseSiteUrl(process.env.SITE_URL) || process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set. Set it in .env.local or the environment.");
  process.exit(1);
}

if (!baseUrl) {
  console.error(
    "SITE_URL is not set.\n" +
      "Set SITE_URL in .env.local or pass the deployment URL as the first argument:\n" +
      "  node scripts/set-telegram-webhook.mjs https://your-app.vercel.app"
  );
  process.exit(1);
}

let webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/sfn/telegram-webhook`;

if (secret) {
  webhookUrl += "?secret=" + encodeURIComponent(secret);
}

const apiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

console.log("Setting Telegram webhook to:", webhookUrl);

const res = await fetch(apiUrl);
const data = await res.json();

if (!data.ok) {
  console.error("Telegram API error:", data.description || data);
  process.exit(1);
}

console.log("Webhook set successfully.");
if (data.result) console.log("Result:", data.result);
