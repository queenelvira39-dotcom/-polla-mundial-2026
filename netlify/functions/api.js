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

  // Partidos de hoy — Colombia UTC-5, dia va de T05:00Z a T04:59Z del dia siguiente
  const todayStart = new Date(today + 'T05:00:00Z');
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const { data: todayMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('status', 'finished')
    .gte('kickoff_utc', todayStart.toISOString())
    .lt('kickoff_utc', todayEnd.toISOString())
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

  // ── ACTUALIZAR PERFIL ───────────────────────────────────────
  if (path === '/profile/update' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });
    const { name, photo_url, language } = body;
    const updates = {};
    if (name && name.trim().length > 0) updates.name = name.trim().slice(0, 50);
    if (photo_url !== undefined) updates.photo_url = photo_url;
    if (language && ['es','en','pt'].includes(language)) updates.language = language;
    if (!Object.keys(updates).length) return resp(400, { error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('participants').update(updates).eq('id', participant.id).select().single();
    if (error) return resp(500, { error: error.message });
    return resp(200, { participant: data });
  }

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
      .select('*')
      .eq('match_id', matchId);

    // Obtener nombres de participantes por separado (fix RLS)
    const participantIds = (preds || []).map(p => p.participant_id);
    const { data: partNames } = await supabase
      .from('participants')
      .select('id, name')
      .in('id', participantIds.length > 0 ? participantIds : ['00000000-0000-0000-0000-000000000000']);
    const nameMap = {};
    (partNames || []).forEach(p => { nameMap[p.id] = p.name; });

    const result = (preds || []).map(p => {
      const isMine = p.participant_id === participant.id;
      const isAdmin = requireAdmin(participant);
      const canSee = isMine || isAdmin || matchStarted;
      return {
        participant_id: p.participant_id,
        participant_name: nameMap[p.participant_id] || 'Jugador',
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

  // ── DETALLE DE PUNTOS POR PARTIDO (admin) ────────────────
  if (path.match(/^\/admin\/matches\/[^/]+\/points$/) && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const matchId = path.split('/')[3];
    const { data: match } = await supabase.from('matches').select('*').eq('id', matchId).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });
    const { data: details } = await supabase
      .from('points_detail')
      .select('*, participants(name)')
      .eq('match_id', matchId)
      .order('pts_total', { ascending: false });
    const { data: preds } = await supabase
      .from('predictions')
      .select('participant_id, pred_score_a, pred_score_b, pred_penalty_winner')
      .eq('match_id', matchId);
    const predMap = {};
    (preds || []).forEach(p => { predMap[p.participant_id] = p; });
    const enriched = (details || []).map(d => ({
      name: d.participants?.name,
      pred_score_a: predMap[d.participant_id]?.pred_score_a ?? null,
      pred_score_b: predMap[d.participant_id]?.pred_score_b ?? null,
      pred_penalty_winner: predMap[d.participant_id]?.pred_penalty_winner ?? null,
      real_score_a: match.score_a,
      real_score_b: match.score_b,
      real_penalty_winner: match.penalty_winner,
      pts_score_a: d.pts_score_a,
      pts_score_b: d.pts_score_b,
      pts_winner: d.pts_winner,
      pts_penalty: d.pts_penalty,
      pts_total: d.pts_total
    }));
    return resp(200, { match, details: enriched });
  }

  // ── EXPORT CSV (admin) ────────────────────────────────────
  if (path === '/admin/export/csv' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { data: parts } = await supabase.from('leaderboard').select('*').order('rank');
    const { data: matches } = await supabase.from('matches').select('*').eq('is_test', false).order('kickoff_utc');
    const { data: preds } = await supabase.from('predictions').select('*, participants(name)');
    const { data: pointsD } = await supabase.from('points_detail').select('*, participants(name), matches(team_a,team_b)');

    // CSV tabla de posiciones
    const NL = '\n';
    let csv = 'TABLA DE POSICIONES' + NL;
    csv += 'Pos,Nombre,Pts Goles,Pts Resultado,Pts Penales,Total,Pronosticos' + NL;
    (parts || []).forEach(p => {
      csv += p.rank + ',"' + p.name + '",' + (p.pts_scores||0) + ',' + (p.pts_winners||0) + ',' + (p.pts_penalties||0) + ',' + p.total_points + ',' + (p.predictions_made||0) + NL;
    });
    csv += NL + 'PUNTOS POR PARTIDO' + NL;
    csv += 'Jugador,Partido,Pronostico,Gol Local,Gol Visit,Resultado,Penales,Total' + NL;
    (pointsD || []).forEach(d => {
      const pred = (preds || []).find(p => p.participant_id === d.participant_id && p.match_id === d.match_id);
      const pronostico = pred ? (pred.pred_score_a + '-' + pred.pred_score_b) : '-';
      csv += '"' + (d.participants && d.participants.name ? d.participants.name : '') + '",';
      csv += '"' + (d.matches ? d.matches.team_a + ' vs ' + d.matches.team_b : '') + '",';
      csv += pronostico + ',' + d.pts_score_a + ',' + d.pts_score_b + ',' + d.pts_winner + ',' + d.pts_penalty + ',' + d.pts_total + NL;
    });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="polla2026_backup.csv"',
        'Access-Control-Allow-Origin': '*'
      },
      body: csv
    };
  }

  // ── PUNTOS DEL DÍA ───────────────────────────────────────
  if (path === '/leaderboard/day' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });
    const date = params.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const dayStart = new Date(date + 'T05:00:00Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const { data: dayMatches } = await supabase
      .from('matches').select('id')
      .gte('kickoff_utc', dayStart.toISOString())
      .lt('kickoff_utc', dayEnd.toISOString())
      .eq('status', 'finished');
    const matchIds = (dayMatches || []).map(m => m.id);
    if (!matchIds.length) return resp(200, { day_leaderboard: [] });
    const { data: parts } = await supabase.from('participants').select('id, name').eq('is_active', true);
    const { data: pts } = await supabase.from('points_detail').select('participant_id, pts_total').in('match_id', matchIds);
    const dayPts = {};
    (pts || []).forEach(p => {
      dayPts[p.participant_id] = (dayPts[p.participant_id] || 0) + p.pts_total;
    });
    const result = (parts || [])
      .map(p => ({ id: p.id, name: p.name, day_points: dayPts[p.id] || 0 }))
      .sort((a, b) => b.day_points - a.day_points)
      .map((p, i) => ({ ...p, day_rank: i + 1 }));
    return resp(200, { day_leaderboard: result, date });
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

    // 6 grupos de 4: top 2 de cada grupo (12) + 4 mejores terceros (4) = 16
    const { data: standings } = await supabase.from('copa_standings').select('*').order('group_number').order('group_rank');
    if (!standings) return resp(500, { error: 'Sin datos de grupos' });

    const classified = [];
    const thirds = [];
    const groups = [...new Set(standings.map(s => s.group_number))];

    for (const g of groups) {
      const group = standings.filter(s => s.group_number === g).sort((a,b) => b.total_points - a.total_points);
      // Top 2 de cada grupo clasifican directamente
      classified.push(...group.filter(s => s.group_rank <= 2));
      // Terceros van al pool de mejores terceros
      const third = group.find(s => s.group_rank === 3);
      if (third) thirds.push(third);
    }

    // Los 4 mejores terceros por puntos
    thirds.sort((a, b) => b.total_points - a.total_points);
    classified.push(...thirds.slice(0, 4));

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
    const in31 = new Date(now.getTime() + 31 * 60000);
    const in29 = new Date(now.getTime() + 29 * 60000);

    const { data: upcoming } = await supabase.from('matches').select('*').eq('status', 'scheduled').gte('kickoff_utc', in29.toISOString()).lte('kickoff_utc', in31.toISOString());

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

    const { data: liveMatches } = await supabase.from('matches').select('*').eq('status', 'scheduled').not('api_match_id', 'is', null).lte('kickoff_utc', new Date().toISOString());

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
