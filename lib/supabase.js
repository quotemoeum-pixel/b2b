// lib/supabase.js
import { createClient } from '@supabase/supabase-js';

// Supabase 클라이언트 초기화
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 클라이언트가 아직 초기화되지 않았으면 초기화
export const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;