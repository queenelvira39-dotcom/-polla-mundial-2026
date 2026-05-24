-- ============================================================
-- POLLA MUNDIAL 2026 — Schema Supabase
-- Zonas horarias: Colombia (UTC-5), Brasil/Brasilia (UTC-3), USA/Florida (UTC-5)
-- ============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PARTICIPANTES
-- ============================================================
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Bogota', -- America/Bogota | America/Sao_Paulo | America/New_York
  access_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  role TEXT NOT NULL DEFAULT 'player', -- 'player' | 'admin'
  cuota INTEGER NOT NULL DEFAULT 50000, -- valor en moneda local
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_access TIMESTAMPTZ
);

-- ============================================================
-- PARTIDOS (fixture completo Mundial 2026)
-- ============================================================
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase TEXT NOT NULL, -- 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final'
  group_name TEXT, -- 'A'..'V' solo para fase de grupos
  match_number INTEGER NOT NULL,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  kickoff_utc TIMESTAMPTZ NOT NULL, -- hora de inicio en UTC
  venue TEXT,
  -- Resultado real
  score_a INTEGER, -- goles tiempo reglamentario + alargue
  score_b INTEGER,
  went_to_penalties BOOLEAN DEFAULT false,
  penalty_winner TEXT, -- nombre del equipo ganador en penales
  status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled'|'live'|'finished'
  api_match_id TEXT, -- ID en API-Football para sincronización automática
  is_test BOOLEAN DEFAULT false, -- true = partido ficticio de prueba
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRONÓSTICOS
-- ============================================================
CREATE TABLE predictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pred_score_a INTEGER NOT NULL,
  pred_score_b INTEGER NOT NULL,
  pred_penalty_winner TEXT, -- solo aplica en eliminatorias
  entered_by_admin BOOLEAN DEFAULT false, -- true si lo ingresó un admin
  admin_id UUID REFERENCES participants(id),
  locked BOOLEAN DEFAULT false, -- true cuando el partido inicia
  points_earned INTEGER, -- calculado automáticamente al terminar partido
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, match_id)
);

-- ============================================================
-- PUNTOS POR PARTIDO (detalle del cálculo)
-- ============================================================
CREATE TABLE points_detail (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pts_score_a INTEGER DEFAULT 0,  -- 0 o 1
  pts_score_b INTEGER DEFAULT 0,  -- 0 o 1
  pts_winner INTEGER DEFAULT 0,   -- 0 o 2
  pts_penalty INTEGER DEFAULT 0,  -- 0 o 1
  pts_total INTEGER DEFAULT 0,    -- suma (max 5)
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, match_id)
);

-- ============================================================
-- NOTIFICACIONES ENVIADAS
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'reminder_player' | 'reminder_admin' | 'result' | 'welcome'
  channel TEXT NOT NULL DEFAULT 'email', -- 'email'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN DEFAULT true,
  error_msg TEXT
);

-- ============================================================
-- CONFIGURACIÓN DEL SISTEMA
-- ============================================================
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO config (key, value) VALUES
  ('pts_score_a', '1'),
  ('pts_score_b', '1'),
  ('pts_winner', '2'),
  ('pts_penalty', '1'),
  ('cuota_default', '50000'),
  ('tournament_name', 'Polla Mundial 2026'),
  ('mode', 'test'), -- 'test' | 'production'
  ('reminder_minutes_before', '10'),
  ('api_football_key', ''), -- se configura desde el panel admin
  ('gmail_user', ''), -- email remitente
  ('admin_emails', ''); -- emails admins separados por coma

-- ============================================================
-- VISTA: Tabla de posiciones
-- ============================================================
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,
  p.name,
  p.email,
  p.timezone,
  p.cuota,
  p.role,
  COALESCE(SUM(pd.pts_total), 0) AS total_points,
  COALESCE(SUM(pd.pts_score_a), 0) + COALESCE(SUM(pd.pts_score_b), 0) AS pts_scores,
  COALESCE(SUM(pd.pts_winner), 0) AS pts_winners,
  COALESCE(SUM(pd.pts_penalty), 0) AS pts_penalties,
  COUNT(pr.id) AS predictions_made,
  RANK() OVER (ORDER BY COALESCE(SUM(pd.pts_total), 0) DESC) AS rank
FROM participants p
LEFT JOIN points_detail pd ON pd.participant_id = p.id
LEFT JOIN predictions pr ON pr.participant_id = p.id
WHERE p.is_active = true
GROUP BY p.id, p.name, p.email, p.timezone, p.cuota, p.role;

-- ============================================================
-- VISTA: Partidos pendientes de pronóstico por participante
-- ============================================================
CREATE OR REPLACE VIEW pending_predictions AS
SELECT
  p.id AS participant_id,
  p.name AS participant_name,
  p.email,
  m.id AS match_id,
  m.match_number,
  m.team_a,
  m.team_b,
  m.kickoff_utc,
  m.phase,
  m.group_name
FROM participants p
CROSS JOIN matches m
LEFT JOIN predictions pr
  ON pr.participant_id = p.id AND pr.match_id = m.id
WHERE m.status = 'scheduled'
  AND m.kickoff_utc > NOW()
  AND pr.id IS NULL
  AND p.is_active = true
ORDER BY m.kickoff_utc, p.name;

-- ============================================================
-- FUNCIÓN: Calcular puntos de un partido al terminar
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_match_points(p_match_id UUID)
RETURNS void AS $$
DECLARE
  v_match matches%ROWTYPE;
  v_pred predictions%ROWTYPE;
  v_pts_a INTEGER;
  v_pts_b INTEGER;
  v_pts_w INTEGER;
  v_pts_p INTEGER;
  v_total INTEGER;
  pred_sign INTEGER;
  real_sign INTEGER;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match.status != 'finished' THEN RETURN; END IF;

  FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
    -- Punto por gol local exacto
    v_pts_a := CASE WHEN v_pred.pred_score_a = v_match.score_a THEN 1 ELSE 0 END;
    -- Punto por gol visitante exacto
    v_pts_b := CASE WHEN v_pred.pred_score_b = v_match.score_b THEN 1 ELSE 0 END;
    -- 2 puntos por resultado (ganador o empate)
    pred_sign := SIGN(v_pred.pred_score_a - v_pred.pred_score_b);
    real_sign := SIGN(v_match.score_a - v_match.score_b);
    v_pts_w := CASE WHEN pred_sign = real_sign THEN 2 ELSE 0 END;
    -- 1 punto bonus por penales (solo si hubo penales)
    v_pts_p := 0;
    IF v_match.went_to_penalties AND v_pred.pred_penalty_winner IS NOT NULL THEN
      v_pts_p := CASE WHEN v_pred.pred_penalty_winner = v_match.penalty_winner THEN 1 ELSE 0 END;
    END IF;

    v_total := v_pts_a + v_pts_b + v_pts_w + v_pts_p;

    -- Guardar detalle
    INSERT INTO points_detail (participant_id, match_id, pts_score_a, pts_score_b, pts_winner, pts_penalty, pts_total)
    VALUES (v_pred.participant_id, p_match_id, v_pts_a, v_pts_b, v_pts_w, v_pts_p, v_total)
    ON CONFLICT (participant_id, match_id) DO UPDATE SET
      pts_score_a = EXCLUDED.pts_score_a,
      pts_score_b = EXCLUDED.pts_score_b,
      pts_winner = EXCLUDED.pts_winner,
      pts_penalty = EXCLUDED.pts_penalty,
      pts_total = EXCLUDED.pts_total,
      calculated_at = NOW();

    -- Actualizar predicción
    UPDATE predictions SET points_earned = v_total WHERE id = v_pred.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN: Bloquear pronósticos al inicio del partido
-- ============================================================
CREATE OR REPLACE FUNCTION lock_match_predictions(p_match_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE predictions SET locked = true WHERE match_id = p_match_id;
  UPDATE matches SET status = 'live' WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_detail ENABLE ROW LEVEL SECURITY;

-- Matches: todos pueden leer
CREATE POLICY "matches_read_all" ON matches FOR SELECT USING (true);

-- Points detail: todos pueden leer
CREATE POLICY "points_read_all" ON points_detail FOR SELECT USING (true);

-- Participants: cada quien ve su propio perfil (via token en app)
-- La app usa service_role key en el backend de Netlify Functions — no expone datos

-- ============================================================
-- FIXTURE FASE DE GRUPOS (partidos reales Mundial 2026)
-- Fuente: FIFA / kickoff en UTC
-- ============================================================
-- NOTA: Las fechas exactas se actualizarán cuando FIFA publique el horario oficial.
-- Por ahora se insertan con fechas aproximadas para el ambiente de pruebas.

-- PARTIDOS DE PRUEBA (is_test = true)
INSERT INTO matches (phase, group_name, match_number, team_a, team_b, kickoff_utc, venue, is_test) VALUES
('group', 'TEST', 1, 'Brasil', 'Argentina', NOW() + INTERVAL '1 day', 'Estadio de Prueba', true),
('group', 'TEST', 2, 'España', 'Francia', NOW() + INTERVAL '1 day 3 hours', 'Estadio de Prueba', true),
('group', 'TEST', 3, 'Alemania', 'Portugal', NOW() + INTERVAL '2 days', 'Estadio de Prueba', true),
('group', 'TEST', 4, 'Uruguay', 'Colombia', NOW() + INTERVAL '2 days 3 hours', 'Estadio de Prueba', true),
('group', 'TEST', 5, 'Inglaterra', 'México', NOW() + INTERVAL '3 days', 'Estadio de Prueba', true),
('group', 'TEST', 6, 'Holanda', 'Marruecos', NOW() + INTERVAL '3 days 3 hours', 'Estadio de Prueba', true);
