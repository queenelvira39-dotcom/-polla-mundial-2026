-- ============================================================
-- POLLA MUNDIAL 2026 — Schema Copa + Tabla Dinámica + Resumen
-- Ejecutar en Supabase SQL Editor ANTES del nuevo deploy
-- ============================================================

-- ── TABLA: Grupos de la Copa ──────────────────────────────────
CREATE TABLE IF NOT EXISTS copa_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_number INTEGER NOT NULL, -- 1..5
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_number, participant_id)
);

-- ── TABLA: Bracket eliminatorio de la Copa ────────────────────
CREATE TABLE IF NOT EXISTS copa_bracket (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase TEXT NOT NULL, -- 'r16'|'qf'|'sf'|'final'|'third'
  slot INTEGER NOT NULL, -- posición en el bracket (1..8 en r16, etc.)
  participant_a_id UUID REFERENCES participants(id),
  participant_b_id UUID REFERENCES participants(id),
  winner_id UUID REFERENCES participants(id),
  pts_a INTEGER DEFAULT 0,
  pts_b INTEGER DEFAULT 0,
  total_pts_a INTEGER DEFAULT 0, -- puntos totales acumulados (para desempate final)
  total_pts_b INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- 'pending'|'active'|'finished'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phase, slot)
);

-- ── TABLA: Snapshots diarios de posiciones (para delta ↑↓) ───
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_date DATE NOT NULL,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  copa_group INTEGER,
  copa_phase TEXT, -- fase actual en la Copa
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_date, participant_id)
);

-- ── TABLA: Resúmenes deportivos diarios ──────────────────────
CREATE TABLE IF NOT EXISTS daily_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  summary_date DATE NOT NULL UNIQUE,
  whatsapp_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── VISTA: Posiciones de la Copa por grupo ───────────────────
CREATE OR REPLACE VIEW copa_standings AS
SELECT
  cg.group_number,
  p.id AS participant_id,
  p.name,
  COALESCE(SUM(pd.pts_total), 0) AS total_points,
  COUNT(pr.id) AS predictions_made,
  RANK() OVER (
    PARTITION BY cg.group_number
    ORDER BY COALESCE(SUM(pd.pts_total), 0) DESC
  ) AS group_rank,
  RANK() OVER (
    ORDER BY COALESCE(SUM(pd.pts_total), 0) DESC
  ) AS overall_rank
FROM copa_groups cg
JOIN participants p ON p.id = cg.participant_id
LEFT JOIN points_detail pd ON pd.participant_id = p.id
LEFT JOIN predictions pr ON pr.participant_id = p.id
WHERE p.is_active = true
GROUP BY cg.group_number, p.id, p.name;

-- ── FUNCIÓN: Snapshot diario a medianoche Colombia ───────────
CREATE OR REPLACE FUNCTION take_daily_snapshot()
RETURNS void AS $$
DECLARE
  today DATE := (NOW() AT TIME ZONE 'America/Bogota')::DATE;
BEGIN
  -- Evitar duplicados del mismo día
  DELETE FROM leaderboard_snapshots WHERE snapshot_date = today;

  INSERT INTO leaderboard_snapshots (snapshot_date, participant_id, rank, total_points, copa_group, copa_phase)
  SELECT
    today,
    l.id,
    l.rank::INTEGER,
    l.total_points::INTEGER,
    cg.group_number,
    COALESCE(
      (SELECT phase FROM copa_bracket
       WHERE (participant_a_id = l.id OR participant_b_id = l.id)
       ORDER BY CASE phase
         WHEN 'final' THEN 1 WHEN 'sf' THEN 2 WHEN 'qf' THEN 3
         WHEN 'r16' THEN 4 ELSE 5 END
       LIMIT 1),
      'groups'
    )
  FROM leaderboard l
  LEFT JOIN copa_groups cg ON cg.participant_id = l.id;
END;
$$ LANGUAGE plpgsql;

-- ── FUNCIÓN: Calcular puntos de fase eliminatoria Copa ───────
CREATE OR REPLACE FUNCTION calculate_copa_phase_points(p_phase TEXT)
RETURNS void AS $$
DECLARE
  v_bracket copa_bracket%ROWTYPE;
  pts_a INTEGER;
  pts_b INTEGER;
  total_a INTEGER;
  total_b INTEGER;
  winner UUID;
  -- Mapear fase Copa a fases del Mundial
  world_phase TEXT;
BEGIN
  world_phase := CASE p_phase
    WHEN 'r16'   THEN 'R16'
    WHEN 'qf'    THEN 'QF'
    WHEN 'sf'    THEN 'SF'
    WHEN 'final' THEN 'F'
    ELSE 'R16'
  END;

  FOR v_bracket IN
    SELECT * FROM copa_bracket WHERE phase = p_phase AND status = 'active'
  LOOP
    -- Puntos acumulados SOLO en esta fase del Mundial
    SELECT COALESCE(SUM(pd.pts_total), 0) INTO pts_a
    FROM points_detail pd
    JOIN matches m ON m.id = pd.match_id
    WHERE pd.participant_id = v_bracket.participant_a_id
      AND m.phase = world_phase;

    SELECT COALESCE(SUM(pd.pts_total), 0) INTO pts_b
    FROM points_detail pd
    JOIN matches m ON m.id = pd.match_id
    WHERE pd.participant_id = v_bracket.participant_b_id
      AND m.phase = world_phase;

    -- Puntos totales acumulados para desempate en final
    SELECT COALESCE(SUM(pd.pts_total), 0) INTO total_a
    FROM points_detail pd
    WHERE pd.participant_id = v_bracket.participant_a_id;

    SELECT COALESCE(SUM(pd.pts_total), 0) INTO total_b
    FROM points_detail pd
    WHERE pd.participant_id = v_bracket.participant_b_id;

    -- Determinar ganador
    IF pts_a > pts_b THEN
      winner := v_bracket.participant_a_id;
    ELSIF pts_b > pts_a THEN
      winner := v_bracket.participant_b_id;
    ELSE
      -- Desempate por puntos totales
      IF total_a >= total_b THEN
        winner := v_bracket.participant_a_id;
      ELSE
        winner := v_bracket.participant_b_id;
      END IF;
    END IF;

    UPDATE copa_bracket SET
      pts_a = pts_a,
      pts_b = pts_b,
      total_pts_a = total_a,
      total_pts_b = total_b,
      winner_id = winner,
      status = 'finished'
    WHERE id = v_bracket.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── FUNCIÓN: Generar siguiente ronda del bracket Copa ─────────
CREATE OR REPLACE FUNCTION advance_copa_bracket(p_phase TEXT)
RETURNS void AS $$
DECLARE
  next_phase TEXT;
  slots_per_match INTEGER;
BEGIN
  next_phase := CASE p_phase
    WHEN 'r16' THEN 'qf'
    WHEN 'qf'  THEN 'sf'
    WHEN 'sf'  THEN 'final'
    ELSE NULL
  END;
  IF next_phase IS NULL THEN RETURN; END IF;

  -- Insertar cruces de la siguiente ronda con los ganadores
  INSERT INTO copa_bracket (phase, slot, participant_a_id, participant_b_id, status)
  SELECT
    next_phase,
    CEIL(slot::float/2)::INTEGER,
    CASE WHEN slot % 2 = 1 THEN winner_id ELSE NULL END,
    CASE WHEN slot % 2 = 0 THEN winner_id ELSE NULL END,
    'pending'
  FROM copa_bracket
  WHERE phase = p_phase AND status = 'finished'
  ORDER BY slot
  ON CONFLICT (phase, slot) DO UPDATE SET
    participant_a_id = COALESCE(copa_bracket.participant_a_id, EXCLUDED.participant_a_id),
    participant_b_id = COALESCE(copa_bracket.participant_b_id, EXCLUDED.participant_b_id),
    status = CASE
      WHEN copa_bracket.participant_a_id IS NOT NULL AND EXCLUDED.participant_b_id IS NOT NULL THEN 'active'
      WHEN EXCLUDED.participant_a_id IS NOT NULL AND copa_bracket.participant_b_id IS NOT NULL THEN 'active'
      ELSE 'pending'
    END;
END;
$$ LANGUAGE plpgsql;

-- ── PERMISOS ──────────────────────────────────────────────────
GRANT ALL ON copa_groups TO service_role;
GRANT ALL ON copa_bracket TO service_role;
GRANT ALL ON leaderboard_snapshots TO service_role;
GRANT ALL ON daily_summaries TO service_role;
GRANT SELECT ON copa_standings TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
