#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      const key = m[1];
      const value = m[2].replace(/^["']|["']$/g, "").trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const baseUrl = process.env.BASE_URL || process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set. Set it in .env or the environment.");
  process.exit(1);
}

if (!supabaseUrl && !baseUrl) {
  console.error(
    "Neither NEXT_PUBLIC_SUPABASE_URL nor BASE_URL is set.\n" +
      "Set NEXT_PUBLIC_SUPABASE_URL in .env (recommended) or pass BASE_URL as an argument."
  );
  process.exit(1);
}

let webhookUrl;
if (supabaseUrl) {
  webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/telegram-webhook`;
  console.log("Using Supabase Edge Function URL.");
} else {
  webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  console.log("Using legacy BASE_URL.");
}

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
