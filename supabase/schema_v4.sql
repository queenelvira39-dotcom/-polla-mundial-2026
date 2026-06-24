-- ============================================================
-- SQL v4 — Ejecutar en Supabase ANTES del deploy
-- ============================================================

-- 1. Agregar columnas de idioma y foto a participants
ALTER TABLE participants 
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'es' CHECK (language IN ('es','en','pt')),
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 2. Verificar
SELECT id, name, language, photo_url FROM participants LIMIT 5;
