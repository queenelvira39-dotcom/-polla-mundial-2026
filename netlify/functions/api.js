// netlify/functions/api.js — Polla Mundial 2026 v2
// Incluye: fixes, Copa, tabla dinámica, resumen deportivo IA

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── UTILIDADES ────────────────────────────────────────────────
function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

async function getParticipantByToken(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('participants')
    .select('*')
    .eq('access_token', token.trim())
    .eq('is_active', true)
    .single();
  return data;
}

function requireAdmin(p) { return p && p.role === 'admin'; }

const TZ_LABELS = {
  'America/Bogota': 'Colombia',
  'America/Sao_Paulo': 'Brasil',
  'America/New_York': 'USA/Florida'
};

function formatDate(utcDate, tz) {
  return new Date(utcDate).toLocaleString('es-CO', {
    timeZone: tz || 'America/Bogota',
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ── EMAIL ─────────────────────────────────────────────────────
function getMailer() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

async function sendEmail({ to, subject, html }) {
  try {
    await getMailer().sendMail({
      from: `"Polla Mundial 2026" <${process.env.GMAIL_USER}>`,
      to, subject, html
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function emailWelcome(participant) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const path = participant.role === 'admin' ? '/admin' : '/app';
  const link = `${base}${path}?token=${participant.access_token}`;
  return {
    subject: '⚽ Tu acceso a la Polla Mundial 2026',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#185FA5;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">⚽ Polla Mundial 2026</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0">EE.UU. · Canadá · México</p>
      </div>
      <div style="background:#f8f9fa;padding:28px;border-radius:0 0 12px 12px">
        <h2 style="color:#185FA5;margin:0 0 12px">¡Hola ${participant.name}!</h2>
        <p style="color:#444;line-height:1.6">Ya estás registrado. Toca el botón para ingresar tus pronósticos. <strong>Guarda este enlace</strong> — es tuyo y es único.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="background:#185FA5;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;display:inline-block">
            ${participant.role === 'admin' ? 'Abrir panel admin →' : 'Ingresar mis pronósticos →'}
          </a>
        </div>
        <p style="color:#888;font-size:13px;text-align:center">O copia: <span style="color:#185FA5">${link}</span></p>
        <hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
        <p style="color:#888;font-size:12px;text-align:center">Este enlace es personal e intransferible.</p>
      </div>
    </div>`
  };
}

function emailReminder(participant, match) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const link = `${base}/app?token=${participant.access_token}`;
  const kickoff = formatDate(match.kickoff_utc, participant.timezone);
  return {
    subject: `⏰ ¡Faltan 10 minutos! ${match.team_a} vs ${match.team_b}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#854F0B;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">⏰ ¡Último aviso!</h1>
      </div>
      <div style="background:#FAEEDA;padding:24px;border-radius:0 0 12px 12px">
        <h2 style="color:#633806;margin:0 0 8px">${participant.name}, aún no has pronosticado</h2>
        <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
          <div style="font-size:22px;font-weight:bold;color:#185FA5">${match.team_a} vs ${match.team_b}</div>
          <div style="color:#888;margin-top:4px;font-size:14px">🕐 ${kickoff}</div>
        </div>
        <div style="text-align:center;margin:20px 0">
          <a href="${link}" style="background:#185FA5;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block">
            Ingresar pronóstico ahora →
          </a>
        </div>
      </div>
    </div>`
  };
}

function emailAdminAlert(adminName, match, pendingList, whatsappMsg) {
  const kickoff = formatDate(match.kickoff_utc, 'America/Bogota');
  const names = pendingList.map(p => `• ${p.participant_name}`).join('<br>');
  return {
    subject: `🔔 Admin — ${pendingList.length} sin pronosticar: ${match.team_a} vs ${match.team_b}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#185FA5;padding:20px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:18px">🔔 Aviso Admin — Polla Mundial 2026</h1>
      </div>
      <div style="background:#f8f9fa;padding:24px;border-radius:0 0 12px 12px">
        <p>Hola ${adminName}, faltan <strong>10 minutos</strong> para <strong>${match.team_a} vs ${match.team_b}</strong> (${kickoff}).</p>
        <p style="color:#A32D2D;margin-top:12px"><strong>Sin pronosticar (${pendingList.length}):</strong></p>
        <div style="background:#FCEBEB;padding:12px;border-radius:8px;color:#7A2020;line-height:1.8">${names}</div>
        <div style="background:#EAF3DE;padding:14px;margin-top:14px;border-radius:8px">
          <p style="color:#27500A;font-weight:bold;margin:0 0 8px">📋 Mensaje WhatsApp listo:</p>
          <pre style="color:#27500A;font-size:13px;white-space:pre-wrap;margin:0">${whatsappMsg}</pre>
        </div>
      </div>
    </div>`
  };
}

function generateWhatsappReminder(match, pendingList) {
  const names = pendingList.map(p => `• ${p.participant_name}`).join('\n');
  return `⚽ *Polla Mundial 2026*\n\n⏰ Faltan 10 minutos:\n*${match.team_a} vs ${match.team_b}*\n\nSin pronosticar:\n${names}\n\n¡Entren ya antes del pitazo! 🔒`;
}

// ── RESUMEN DEPORTIVO ─────────────────────────────────────────
async function generateDailySummary() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  // Partidos de hoy
  const { data: todayMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('status', 'finished')
    .gte('kickoff_utc', today + 'T00:00:00Z')
    .lt('kickoff_utc', today + 'T23:59:59Z')
    .order('kickoff_utc');

  // Tabla actual
  const { data: lb } = await supabase.from('leaderboard').select('*').order('total_points', { ascending: false });

  // Snapshot de ayer para el delta
  const { data: snapYesterday } = await supabase
    .from('leaderboard_snapshots')
    .select('*')
    .eq('snapshot_date', yesterday);

  const snapMap = {};
  (snapYesterday || []).forEach(s => { snapMap[s.participant_id] = s; });

  if (!lb || !lb.length) return null;

  const leader = lb[0];
  const snapLeader = snapMap[leader.id];
  const leaderDelta = snapLeader ? (snapLeader.total_points || 0) : 0;
  const leaderGained = leader.total_points - leaderDelta;

  // Construir resumen
  const matchLines = (todayMatches || []).map(m => {
    if (m.score_a === null) return null;
    const pen = m.went_to_penalties ? ` (pen. ${m.penalty_winner})` : '';
    return `⚽ ${m.team_a} ${m.score_a}-${m.score_b} ${m.team_b}${pen}`;
  }).filter(Boolean);

  // Top 3 con movimiento
  const top3Lines = (lb || []).slice(0, 3).map((p, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const snap = snapMap[p.id];
    const prevRank = snap ? snap.rank : null;
    const currentRank = i + 1;
    let movement = '';
    if (prevRank && prevRank !== currentRank) {
      const diff = prevRank - currentRank;
      movement = diff > 0 ? ` ↑${diff}` : ` ↓${Math.abs(diff)}`;
    }
    return `${medals[i]} ${p.name}: ${p.total_points} pts${movement}`;
  });

  // Copa — líder de cada grupo
  const { data: copaStandings } = await supabase
    .from('copa_standings')
    .select('*')
    .eq('group_rank', 1)
    .order('group_number');

  const copaLines = (copaStandings || []).map(c =>
    `  Grupo ${c.group_number}: ${c.name} (${c.total_points} pts)`
  );

  const matchesPlayed = todayMatches?.length || 0;
  const dateStr = new Date().toLocaleDateString('es-ES', {
    timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long'
  });

  let summary = `⚽ *POLLA MUNDIAL 2026*\n📅 Resumen del ${dateStr}\n\n`;

  if (matchLines.length) {
    summary += `🏟️ *RESULTADOS DEL DÍA (${matchesPlayed} partidos)*\n`;
    summary += matchLines.join('\n') + '\n\n';
  } else {
    summary += `😴 Hoy no hubo partidos, pero mañana volvemos con todo.\n\n`;
  }

  summary += `📊 *TABLA GENERAL — TOP 3*\n`;
  summary += top3Lines.join('\n') + '\n';

  if (leaderGained > 0) {
    summary += `\n🔥 ${leader.name} sigue al frente y sumó ${leaderGained} puntos hoy.\n`;
  }

  if (lb.length > 1) {
    const diff = leader.total_points - lb[1].total_points;
    if (diff <= 5) {
      summary += `⚡ ¡Solo ${diff} puntos separan al líder del segundo! Esto está caliente.\n`;
    } else if (diff >= 20) {
      summary += `💪 ${leader.name} se escapa. Los demás necesitan un milagro... o que pierda el internet.\n`;
    }
  }

  if (copaLines.length) {
    summary += `\n🏆 *COPA — LÍDERES POR GRUPO*\n`;
    summary += copaLines.join('\n') + '\n';
  }

  summary += `\n¡Hasta mañana y que los goles estén de su lado! 🙌`;

  // Guardar en BD
  await supabase.from('daily_summaries').upsert({
    summary_date: today,
    whatsapp_text: summary
  }, { onConflict: 'summary_date' });

  // Tomar snapshot del día
  await supabase.rpc('take_daily_snapshot');

  return summary;
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(200, {});

  const params = event.queryStringParameters || {};
  const token = ((event.headers.authorization || '').replace('Bearer ', '').trim()) || params.token || '';
  const path = event.path.replace('/.netlify/functions/api', '').replace(/^\/api/, '') || '/';
  const method = event.httpMethod;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}

  // ── AUTH ──────────────────────────────────────────────────
  if (path === '/auth/me' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'Token inválido' });
    await supabase.from('participants').update({ last_access: new Date() }).eq('id', participant.id);
    return resp(200, { participant });
  }

  // ── PARTIDOS ──────────────────────────────────────────────
  if (path === '/matches' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const mode = (await supabase.from('config').select('value').eq('key', 'mode').single()).data?.value;
    let query = supabase.from('matches').select('*').order('kickoff_utc');
    if (mode === 'test') query = query.eq('is_test', true);
    else query = query.eq('is_test', false);
    const { data: matches } = await query;

    const { data: myPreds } = await supabase
      .from('predictions')
      .select('*')
      .eq('participant_id', participant.id);

    const predMap = {};
    (myPreds || []).forEach(p => { predMap[p.match_id] = p; });

    const now = new Date();
    const enriched = (matches || []).map(m => ({
      ...m,
      my_prediction: predMap[m.id] || null,
      is_locked: m.status !== 'scheduled' || new Date(m.kickoff_utc) <= now
    }));

    return resp(200, { matches: enriched });
  }

  // ── PRONÓSTICOS DE UN PARTIDO ─────────────────────────────
  if (path.startsWith('/matches/') && path.endsWith('/predictions') && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const parts = path.split('/').filter(p => p !== '' && p !== 'matches' && p !== 'predictions');
    const matchId = parts[0];

    const { data: match } = await supabase.from('matches').select('*').eq('id', matchId).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });

    const now = new Date();
    const matchStarted = match.status !== 'scheduled' || new Date(match.kickoff_utc) <= now;

    const { data: preds } = await supabase
      .from('predictions')
      .select('*, participants(name, role)')
      .eq('match_id', matchId);

    const result = (preds || []).map(p => {
      const isMine = p.participant_id === participant.id;
      const isAdmin = requireAdmin(participant);
      const canSee = isMine || isAdmin || matchStarted;
      return {
        participant_id: p.participant_id,
        participant_name: p.participants?.name,
        pred_score_a: canSee ? p.pred_score_a : null,
        pred_score_b: canSee ? p.pred_score_b : null,
        pred_penalty_winner: canSee ? p.pred_penalty_winner : null,
        locked: p.locked,
        points_earned: p.points_earned,
        entered_by_admin: p.entered_by_admin,
        hidden: !canSee
      };
    });

    return resp(200, { predictions: result, match_started: matchStarted });
  }

  // ── GUARDAR PRONÓSTICO ────────────────────────────────────
  if (path === '/predictions' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const { match_id, pred_score_a, pred_score_b, pred_penalty_winner, target_participant_id } = body;

    let targetId = participant.id;
    let enteredByAdmin = false;
    if (target_participant_id && target_participant_id !== participant.id) {
      if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins pueden ingresar pronósticos por otros' });
      targetId = target_participant_id;
      enteredByAdmin = true;
    }

    const { data: match } = await supabase.from('matches').select('*').eq('id', match_id).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });

    const now = new Date();
    if (match.status !== 'scheduled' || new Date(match.kickoff_utc) <= now) {
      return resp(400, { error: 'El partido ya inició — pronóstico bloqueado' });
    }

    // Bloquear mismo resultado en Final de la Copa entre los dos finalistas
    if (match.phase === 'F' || match.phase === 'final') {
      const { data: otherPred } = await supabase
        .from('predictions')
        .select('pred_score_a, pred_score_b')
        .eq('match_id', match_id)
        .neq('participant_id', targetId)
        .single();

      if (otherPred &&
          parseInt(pred_score_a) === otherPred.pred_score_a &&
          parseInt(pred_score_b) === otherPred.pred_score_b) {
        return resp(400, {
          error: '¡Ese marcador ya lo eligió el otro finalista! Debe haber un ganador — cambia al menos un gol.'
        });
      }
    }

    const { data, error } = await supabase
      .from('predictions')
      .upsert({
        participant_id: targetId,
        match_id,
        pred_score_a: parseInt(pred_score_a),
        pred_score_b: parseInt(pred_score_b),
        pred_penalty_winner: pred_penalty_winner || null,
        entered_by_admin: enteredByAdmin,
        admin_id: enteredByAdmin ? participant.id : null,
        updated_at: new Date()
      }, { onConflict: 'participant_id,match_id' })
      .select().single();

    if (error) return resp(500, { error: error.message });
    return resp(200, { prediction: data });
  }

  // ── TABLA DE POSICIONES ───────────────────────────────────
  if (path === '/leaderboard' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const { data: lb } = await supabase.from('leaderboard').select('*').order('total_points', { ascending: false });

    // Delta vs ayer
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const { data: snap } = await supabase.from('leaderboard_snapshots').select('*').eq('snapshot_date', yesterday);
    const snapMap = {};
    (snap || []).forEach(s => { snapMap[s.participant_id] = s; });

    const enriched = (lb || []).map((p, i) => {
      const prev = snapMap[p.id];
      const prevRank = prev ? prev.rank : null;
      const currentRank = i + 1;
      return {
        ...p,
        current_rank: currentRank,
        prev_rank: prevRank,
        rank_delta: prevRank ? prevRank - currentRank : 0
      };
    });

    return resp(200, { leaderboard: enriched });
  }

  // ── COPA: VER GRUPOS Y STANDINGS ──────────────────────────
  if (path === '/copa/standings' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });
    const { data } = await supabase.from('copa_standings').select('*').order('group_number').order('total_points', { ascending: false });
    return resp(200, { standings: data || [] });
  }

  // ── COPA: VER BRACKET ─────────────────────────────────────
  if (path === '/copa/bracket' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });
    const { data } = await supabase
      .from('copa_bracket')
      .select('*, participant_a:participant_a_id(name), participant_b:participant_b_id(name), winner:winner_id(name)')
      .order('phase').order('slot');
    return resp(200, { bracket: data || [] });
  }

  // ── ADMIN: LISTA DE PARTICIPANTES ─────────────────────────
  if (path === '/admin/participants' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { data } = await supabase.from('participants').select('*').order('name');
    return resp(200, { participants: data || [] });
  }

  // ── ADMIN: CREAR PARTICIPANTE ─────────────────────────────
  if (path === '/admin/participants' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const { name, email, timezone, role, cuota } = body;
    const { data: cfg } = await supabase.from('config').select('value').eq('key', 'cuota_default').single();

    const { data: newP, error } = await supabase
      .from('participants')
      .insert({ name, email, timezone: timezone || 'America/Bogota', role: role || 'player', cuota: cuota || parseInt(cfg?.value || 50000) })
      .select().single();

    if (error) return resp(500, { error: error.message });

    const emailContent = emailWelcome(newP);
    const emailResult = await sendEmail({ to: newP.email, ...emailContent });
    await supabase.from('notifications').insert({ participant_id: newP.id, type: 'welcome', channel: 'email', success: emailResult.success });

    return resp(200, { participant: newP, email_sent: emailResult.success });
  }

  // ── ADMIN: INGRESAR RESULTADO REAL ────────────────────────
  if (path.match(/^\/admin\/matches\/[^/]+\/result$/) && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const matchId = path.split('/')[3];
    const { score_a, score_b, went_to_penalties, penalty_winner } = body;

    await supabase.from('matches').update({
      score_a: parseInt(score_a), score_b: parseInt(score_b),
      went_to_penalties: went_to_penalties || false,
      penalty_winner: penalty_winner || null,
      status: 'finished'
    }).eq('id', matchId);

    await supabase.rpc('calculate_match_points', { p_match_id: matchId });
    return resp(200, { success: true });
  }

  // ── ADMIN: COPA — ASIGNAR JUGADORES A GRUPOS ──────────────
  if (path === '/admin/copa/groups' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const { assignments } = body; // [{participant_id, group_number}]
    await supabase.from('copa_groups').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await supabase.from('copa_groups').insert(assignments);
    if (error) return resp(500, { error: error.message });
    return resp(200, { success: true });
  }

  // ── ADMIN: COPA — GENERAR BRACKET OCTAVOS ─────────────────
  if (path === '/admin/copa/bracket/generate' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    // Obtener top 3 de cada grupo + mejor 4° lugar
    const { data: standings } = await supabase.from('copa_standings').select('*').order('group_number').order('group_rank');
    if (!standings) return resp(500, { error: 'Sin datos de grupos' });

    const classified = [];
    const fourths = [];

    for (let g = 1; g <= 5; g++) {
      const group = standings.filter(s => s.group_number === g);
      classified.push(...group.filter(s => s.group_rank <= 3));
      const fourth = group.find(s => s.group_rank === 4);
      if (fourth) fourths.push(fourth);
    }

    // Mejor 4° lugar
    fourths.sort((a, b) => b.total_points - a.total_points);
    if (fourths.length > 0) classified.push(fourths[0]);

    if (classified.length < 16) return resp(400, { error: `Solo hay ${classified.length} clasificados, se necesitan 16` });

    // Generar cruces r16: 1°G1 vs mejor4°, 2°G1 vs 3°G3, etc. (simplificado por posición)
    const bracket = [];
    for (let i = 0; i < 8; i++) {
      bracket.push({
        phase: 'r16',
        slot: i + 1,
        participant_a_id: classified[i].participant_id,
        participant_b_id: classified[15 - i].participant_id,
        status: 'active'
      });
    }

    await supabase.from('copa_bracket').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await supabase.from('copa_bracket').insert(bracket);
    if (error) return resp(500, { error: error.message });
    return resp(200, { success: true, bracket });
  }

  // ── ADMIN: COPA — AVANZAR FASE ────────────────────────────
  if (path === '/admin/copa/bracket/advance' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { phase } = body;
    await supabase.rpc('calculate_copa_phase_points', { p_phase: phase });
    await supabase.rpc('advance_copa_bracket', { p_phase: phase });
    return resp(200, { success: true });
  }

  // ── ADMIN: RECORDATORIOS MANUALES ────────────────────────
  if (path === '/admin/reminders/send' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const { match_id } = body;
    const { data: match } = await supabase.from('matches').select('*').eq('id', match_id).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });

    const { data: pending } = await supabase.from('pending_predictions').select('*').eq('match_id', match_id);
    if (!pending || !pending.length) return resp(200, { message: 'Todos han pronosticado', sent: 0 });

    const whatsappMsg = generateWhatsappReminder(match, pending);
    let sent = 0;
    for (const p of pending) {
      const { data: fullP } = await supabase.from('participants').select('*').eq('id', p.participant_id).single();
      if (!fullP) continue;
      const result = await sendEmail({ to: fullP.email, ...emailReminder(fullP, match) });
      await supabase.from('notifications').insert({ participant_id: fullP.id, match_id: match.id, type: 'reminder_player', channel: 'email', success: result.success });
      if (result.success) sent++;
    }

    const { data: admins } = await supabase.from('participants').select('*').eq('role', 'admin').eq('is_active', true);
    for (const adm of (admins || [])) {
      await sendEmail({ to: adm.email, ...emailAdminAlert(adm.name, match, pending, whatsappMsg) });
    }

    return resp(200, { sent, pending_count: pending.length, whatsapp_message: whatsappMsg });
  }

  // ── ADMIN: RESUMEN DEPORTIVO DIARIO ──────────────────────
  if (path === '/admin/summary/generate' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const summary = await generateDailySummary();
    if (!summary) return resp(500, { error: 'No hay datos suficientes para el resumen' });
    return resp(200, { summary });
  }

  // ── ADMIN: VER ÚLTIMO RESUMEN ─────────────────────────────
  if (path === '/admin/summary/latest' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { data } = await supabase.from('daily_summaries').select('*').order('summary_date', { ascending: false }).limit(1).single();
    return resp(200, { summary: data });
  }

  // ── ADMIN: RESET ──────────────────────────────────────────
  if (path === '/admin/reset' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { data: modeConfig } = await supabase.from('config').select('value').eq('key', 'mode').single();
    if (modeConfig?.value !== 'test') return resp(400, { error: 'Reset solo en modo test' });

    const empty = '00000000-0000-0000-0000-000000000000';
    await supabase.from('points_detail').delete().neq('id', empty);
    await supabase.from('notifications').delete().neq('id', empty);
    await supabase.from('predictions').delete().neq('id', empty);
    await supabase.from('copa_bracket').delete().neq('id', empty);
    await supabase.from('copa_groups').delete().neq('id', empty);
    await supabase.from('leaderboard_snapshots').delete().neq('id', empty);
    await supabase.from('daily_summaries').delete().neq('id', empty);
    await supabase.from('participants').delete().eq('role', 'player');
    await supabase.from('matches').update({ score_a: null, score_b: null, went_to_penalties: false, penalty_winner: null, status: 'scheduled' }).eq('is_test', true);

    return resp(200, { success: true });
  }

  // ── ADMIN: CAMBIAR MODO ───────────────────────────────────
  if (path === '/admin/config/mode' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { mode } = body;
    if (!['test', 'production'].includes(mode)) return resp(400, { error: 'Modo inválido' });
    await supabase.from('config').update({ value: mode }).eq('key', 'mode');
    return resp(200, { success: true, mode });
  }

  // ── CRON: RECORDATORIOS AUTOMÁTICOS ──────────────────────
  if (path === '/cron/reminders' && method === 'POST') {
    if (event.headers['x-cron-secret'] !== process.env.CRON_SECRET) return resp(401, { error: 'No autorizado' });

    const now = new Date();
    const in11 = new Date(now.getTime() + 11 * 60000);
    const in9  = new Date(now.getTime() + 9  * 60000);

    const { data: upcoming } = await supabase.from('matches').select('*').eq('status', 'scheduled').gte('kickoff_utc', in9.toISOString()).lte('kickoff_utc', in11.toISOString());

    for (const match of (upcoming || [])) {
      const { data: pending } = await supabase.from('pending_predictions').select('*').eq('match_id', match.id);
      if (!pending?.length) continue;
      const whatsappMsg = generateWhatsappReminder(match, pending);
      for (const p of pending) {
        const { data: fullP } = await supabase.from('participants').select('*').eq('id', p.participant_id).single();
        if (!fullP) continue;
        const { data: already } = await supabase.from('notifications').select('id').eq('participant_id', fullP.id).eq('match_id', match.id).eq('type', 'reminder_player').single();
        if (already) continue;
        const result = await sendEmail({ to: fullP.email, ...emailReminder(fullP, match) });
        await supabase.from('notifications').insert({ participant_id: fullP.id, match_id: match.id, type: 'reminder_player', channel: 'email', success: result.success });
      }
      const { data: admins } = await supabase.from('participants').select('*').eq('role', 'admin').eq('is_active', true);
      for (const adm of (admins || [])) {
        await sendEmail({ to: adm.email, ...emailAdminAlert(adm.name, match, pending, whatsappMsg) });
      }
    }

    // Bloquear partidos iniciados
    const { data: started } = await supabase.from('matches').select('id').eq('status', 'scheduled').lte('kickoff_utc', now.toISOString());
    for (const m of (started || [])) {
      await supabase.rpc('lock_match_predictions', { p_match_id: m.id });
    }

    // Snapshot a medianoche Colombia (00:00 - 00:05)
    const hourColombia = now.toLocaleString('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false });
    const minuteColombia = now.getMinutes();
    if (parseInt(hourColombia) === 0 && minuteColombia < 5) {
      await supabase.rpc('take_daily_snapshot');
      await generateDailySummary();
    }

    return resp(200, { checked: upcoming?.length || 0 });
  }

  // ── CRON: SINCRONIZAR RESULTADOS ─────────────────────────
  if (path === '/cron/sync-results' && method === 'POST') {
    if (event.headers['x-cron-secret'] !== process.env.CRON_SECRET) return resp(401, { error: 'No autorizado' });

    const { data: apiKeyConfig } = await supabase.from('config').select('value').eq('key', 'api_football_key').single();
    const apiKey = apiKeyConfig?.value;
    if (!apiKey) return resp(200, { message: 'API key no configurada' });

    const { data: liveMatches } = await supabase.from('matches').select('*').in('status', ['live', 'scheduled']).not('api_match_id', 'is', null).lte('kickoff_utc', new Date().toISOString());

    let updated = 0;
    for (const match of (liveMatches || [])) {
      try {
        const res = await fetch(`https://v3.football.api-sports.io/fixtures?id=${match.api_match_id}`, {
          headers: { 'x-apisports-key': apiKey }
        });
        const json = await res.json();
        const fixture = json.response?.[0];
        if (!fixture) continue;
        const status = fixture.fixture.status.short;
        if (['FT', 'AET', 'PEN'].includes(status)) {
          const wentPen = status === 'PEN';
          let penWinner = null;
          if (wentPen) {
            const penA = fixture.score.penalty.home;
            const penB = fixture.score.penalty.away;
            penWinner = penA > penB ? match.team_a : match.team_b;
          }
          await supabase.from('matches').update({ score_a: fixture.goals.home, score_b: fixture.goals.away, went_to_penalties: wentPen, penalty_winner: penWinner, status: 'finished' }).eq('id', match.id);
          await supabase.rpc('calculate_match_points', { p_match_id: match.id });
          updated++;
        }
      } catch (e) { console.error('sync error:', e.message); }
    }
    return resp(200, { updated });
  }

  return resp(404, { error: 'Ruta no encontrada' });
};
