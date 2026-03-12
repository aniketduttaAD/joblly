// API Key management utilities
const API_KEY_STORAGE_KEY = "openai_api_key";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function hasApiKey(): boolean {
  return getApiKey() !== null && getApiKey() !== "";
}
