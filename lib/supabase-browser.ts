"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  (typeof window !== "undefined"
    ? ((window as unknown as Record<string, string>).__NEXT_PUBLIC_SUPABASE_URL__ ?? "")
    : "");

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "";

export const supabaseBrowserClient = createClient(supabaseUrl, supabaseAnonKey);
