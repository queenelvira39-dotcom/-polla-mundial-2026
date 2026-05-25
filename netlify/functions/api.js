// netlify/functions/api.js
// Backend completo de la Polla Mundial 2026
// Maneja: auth, pronósticos, resultados, notificaciones, admin

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key — nunca se expone al cliente
);

// ============================================================
// UTILIDADES
// ============================================================

// Zonas horarias soportadas
const TIMEZONES = {
  'America/Bogota': 'Colombia (UTC-5)',
  'America/Sao_Paulo': 'Brasil/Brasilia (UTC-3)',
  'America/New_York': 'USA/Florida (UTC-5)'
};

// Formatea fecha en zona horaria del participante
function formatDateForTz(utcDate, tz) {
  return new Date(utcDate).toLocaleString('es-CO', {
    timeZone: tz,
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Respuesta estándar
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

// Validar token de participante
async function getParticipantByToken(token) {
  if (!token) return null;
  console.log('TOKEN RECIBIDO:', JSON.stringify(token));
  console.log('TOKEN LENGTH:', token.length);
  const { data, error } = await supabase
    .from('participants')
    .select('*')
    .eq('access_token', token)
    .eq('is_active', true)
    .single();
  console.log('SUPABASE DATA:', JSON.stringify(data));
  console.log('SUPABASE ERROR:', JSON.stringify(error));
  return data;
}

// Validar que es admin
function requireAdmin(participant) {
  return participant && participant.role === 'admin';
}

// ============================================================
// EMAIL: Configuración nodemailer con Gmail
// ============================================================
function getMailer() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD // App Password de Google
    }
  });
}

async function sendEmail({ to, subject, html }) {
  try {
    const mailer = getMailer();
    await mailer.sendMail({
      from: `"Polla Mundial 2026" <${process.env.GMAIL_USER}>`,
      to, subject, html
    });
    return { success: true };
  } catch (e) {
    console.error('Email error:', e);
    return { success: false, error: e.message };
  }
}

// Template: Bienvenida con link personal
function emailWelcome(participant, baseUrl) {
  const link = `${baseUrl}/app?token=${participant.access_token}`;
  return {
    subject: '⚽ Tu acceso a la Polla Mundial 2026',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#185FA5;padding:24px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:24px">⚽ Polla Mundial 2026</h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0">EE.UU. · Canadá · México</p>
        </div>
        <div style="background:#f8f9fa;padding:28px;border-radius:0 0 12px 12px">
          <h2 style="color:#185FA5;margin:0 0 12px">¡Hola ${participant.name}!</h2>
          <p style="color:#444;line-height:1.6">Ya estás registrado en la polla. Usa este botón para ingresar tus pronósticos. <strong>Guarda este enlace</strong> — es tuyo y es único.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${link}" style="background:#185FA5;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;display:inline-block">
              Ingresar mis pronósticos →
            </a>
          </div>
          <p style="color:#888;font-size:13px;text-align:center">O copia este enlace: <br><span style="color:#185FA5">${link}</span></p>
          <hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
          <p style="color:#888;font-size:12px;text-align:center">Este enlace es personal e intransferible. No lo compartas.</p>
        </div>
      </div>
    `
  };
}

// Template: Recordatorio 10 minutos antes
function emailReminder(participant, match) {
  const link = `${process.env.APP_BASE_URL}/app?token=${participant.access_token}`;
  const kickoff = formatDateForTz(match.kickoff_utc, participant.timezone);
  return {
    subject: `⏰ ¡Faltan 10 minutos! ${match.team_a} vs ${match.team_b}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#854F0B;padding:20px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:20px">⏰ ¡Último aviso!</h1>
        </div>
        <div style="background:#FAEEDA;padding:24px;border-radius:0 0 12px 12px">
          <h2 style="color:#633806;margin:0 0 8px">${participant.name}, aún no has pronosticado</h2>
          <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
            <div style="font-size:22px;font-weight:bold;color:#185FA5">${match.team_a} vs ${match.team_b}</div>
            <div style="color:#888;margin-top:4px;font-size:14px">🕐 ${kickoff}</div>
          </div>
          <p style="color:#633806">En 10 minutos el partido comienza y ya no podrás ingresar tu pronóstico.</p>
          <div style="text-align:center;margin:20px 0">
            <a href="${link}" style="background:#185FA5;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block">
              Ingresar pronóstico ahora →
            </a>
          </div>
        </div>
      </div>
    `
  };
}

// Template: Aviso a admins de participantes pendientes
function emailAdminAlert(adminName, match, pendingList, whatsappMsg) {
  const kickoff = formatDateForTz(match.kickoff_utc, 'America/Bogota');
  const names = pendingList.map(p => `• ${p.participant_name}`).join('<br>');
  return {
    subject: `🔔 Admin — ${pendingList.length} sin pronosticar: ${match.team_a} vs ${match.team_b}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#185FA5;padding:20px;border-radius:12px 12px 0 0">
          <h1 style="color:white;margin:0;font-size:18px">🔔 Polla Mundial 2026 — Aviso Admin</h1>
        </div>
        <div style="background:#f8f9fa;padding:24px;border-radius:0 0 12px 12px">
          <p style="color:#444">Hola ${adminName}, faltan <strong>10 minutos</strong> para:</p>
          <div style="background:white;border-radius:8px;padding:16px;margin:12px 0;text-align:center">
            <div style="font-size:20px;font-weight:bold;color:#185FA5">${match.team_a} vs ${match.team_b}</div>
            <div style="color:#888;font-size:13px;margin-top:4px">${kickoff} (hora Colombia)</div>
          </div>
          <p style="color:#A32D2D;font-weight:500">Sin pronosticar (${pendingList.length}):</p>
          <div style="background:#FCEBEB;border-radius:8px;padding:12px 16px;color:#7A2020;line-height:1.8">${names}</div>
          <div style="background:#EAF3DE;border-radius:8px;padding:16px;margin-top:16px">
            <p style="color:#27500A;font-weight:500;margin:0 0 8px">📋 Mensaje listo para WhatsApp:</p>
            <pre style="color:#27500A;font-size:13px;white-space:pre-wrap;margin:0">${whatsappMsg}</pre>
          </div>
          <p style="color:#888;font-size:12px;margin-top:16px">Puedes ingresar el pronóstico de un jugador desde el panel de administración.</p>
        </div>
      </div>
    `
  };
}

// Genera mensaje de WhatsApp listo para copiar
function generateWhatsappMessage(match, pendingList) {
  const names = pendingList.map(p => `• ${p.participant_name}`).join('\n');
  return `⚽ *Polla Mundial 2026*\n\n⏰ Faltan 10 minutos para:\n*${match.team_a} vs ${match.team_b}*\n\nAún no han pronosticado:\n${names}\n\n¡Ingresen ya antes de que inicie el partido! 🔒`;
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(200, {});

const params = event.queryStringParameters || {};
const token = (event.headers.authorization || '').replace('Bearer ', '').trim() || 
              params.token || '';
  const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  const method = event.httpMethod;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}

  // ── AUTH: Verificar token y retornar participante ──────────
  if (path === '/auth/me' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'Token inválido' });
    // Actualizar último acceso
    await supabase.from('participants').update({ last_access: new Date() }).eq('id', participant.id);
    return resp(200, { participant });
  }

  // ── PARTIDOS: Lista de partidos ────────────────────────────
  if (path === '/matches' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const mode = (await supabase.from('config').select('value').eq('key','mode').single()).data?.value;
    let query = supabase.from('matches').select('*').order('kickoff_utc');
    if (mode === 'test') query = query.eq('is_test', true);
    else query = query.eq('is_test', false);

    const { data: matches } = await query;

    // Obtener pronósticos del participante
    const { data: myPreds, error: predError } = await supabase
      .from('predictions')
      .select('*')
      .eq('participant_id', participant.id);

console.log('MY PREDS:', JSON.stringify(myPreds));
console.log('PRED ERROR:', JSON.stringify(predError));

    const predMap = {};
    (myPreds || []).forEach(p => { predMap[p.match_id] = p; });

    // Para cada partido, indicar si está bloqueado y adjuntar mi predicción
    const enriched = (matches || []).map(m => ({
      ...m,
      my_prediction: predMap[m.id] || null,
      is_locked: m.status !== 'scheduled' || new Date(m.kickoff_utc) <= new Date()
    }));

    return resp(200, { matches: enriched });
  }

  // ── PRONÓSTICOS: Ver pronósticos de un partido ─────────────
  if (path.startsWith('/matches/') && path.endsWith('/predictions') && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const matchId = path.split('/')[2];
    const { data: match } = await supabase.from('matches').select('*').eq('id', matchId).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });

    const matchStarted = match.status !== 'scheduled' || new Date(match.kickoff_utc) <= new Date();

    // Solo se revelan pronósticos ajenos si el partido ya inició
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

  // ── PRONÓSTICOS: Guardar / actualizar ─────────────────────
  if (path === '/predictions' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const { match_id, pred_score_a, pred_score_b, pred_penalty_winner, target_participant_id } = body;

    // Si viene target_participant_id, el admin está ingresando por otro
    let targetId = participant.id;
    let enteredByAdmin = false;
    if (target_participant_id && target_participant_id !== participant.id) {
      if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins pueden ingresar pronósticos por otros' });
      targetId = target_participant_id;
      enteredByAdmin = true;
    }

    // Verificar que el partido existe y no ha iniciado
    const { data: match } = await supabase.from('matches').select('*').eq('id', match_id).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });
    if (match.status !== 'scheduled' || new Date(match.kickoff_utc) <= new Date()) {
      return resp(400, { error: 'El partido ya inició — pronóstico bloqueado' });
    }

    const predData = {
      participant_id: targetId,
      match_id,
      pred_score_a: parseInt(pred_score_a),
      pred_score_b: parseInt(pred_score_b),
      pred_penalty_winner: pred_penalty_winner || null,
      entered_by_admin: enteredByAdmin,
      admin_id: enteredByAdmin ? participant.id : null,
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('predictions')
      .upsert(predData, { onConflict: 'participant_id,match_id' })
      .select().single();

    if (error) return resp(500, { error: error.message });
    return resp(200, { prediction: data });
  }

  // ── TABLA DE POSICIONES ────────────────────────────────────
  if (path === '/leaderboard' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!participant) return resp(401, { error: 'No autorizado' });

    const { data } = await supabase.from('leaderboard').select('*');
    return resp(200, { leaderboard: data || [] });
  }

  // ── ADMIN: Lista de participantes ──────────────────────────
  if (path === '/admin/participants' && method === 'GET') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { data } = await supabase.from('participants').select('*').order('name');
    return resp(200, { participants: data || [] });
  }

  // ── ADMIN: Crear participante ──────────────────────────────
  if (path === '/admin/participants' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const { name, email, timezone, role, cuota } = body;
    const { data: config } = await supabase.from('config').select('value').eq('key','cuota_default').single();

    const { data: newP, error } = await supabase
      .from('participants')
      .insert({
        name, email,
        timezone: timezone || 'America/Bogota',
        role: role || 'player',
        cuota: cuota || parseInt(config?.value || 50000)
      })
      .select().single();

    if (error) return resp(500, { error: error.message });

    // Enviar email de bienvenida con link
    const emailContent = emailWelcome(newP, process.env.APP_BASE_URL);
    const emailResult = await sendEmail({ to: newP.email, ...emailContent });

    // Registrar notificación
    await supabase.from('notifications').insert({
      participant_id: newP.id,
      type: 'welcome',
      channel: 'email',
      success: emailResult.success,
      error_msg: emailResult.error || null
    });

    return resp(200, { participant: newP, email_sent: emailResult.success });
  }

  // ── ADMIN: Ingresar resultado real de un partido ───────────
  if (path.startsWith('/admin/matches/') && path.endsWith('/result') && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const matchId = path.split('/')[3];
    const { score_a, score_b, went_to_penalties, penalty_winner } = body;

    // Actualizar partido
    const { error: matchError } = await supabase.from('matches').update({
      score_a: parseInt(score_a),
      score_b: parseInt(score_b),
      went_to_penalties: went_to_penalties || false,
      penalty_winner: penalty_winner || null,
      status: 'finished'
    }).eq('id', matchId);

    if (matchError) return resp(500, { error: matchError.message });

    // Calcular puntos via función de Supabase
    await supabase.rpc('calculate_match_points', { p_match_id: matchId });

    return resp(200, { success: true, message: 'Resultado guardado y puntos calculados' });
  }

  // ── ADMIN: Enviar recordatorios manuales ───────────────────
  if (path === '/admin/reminders/send' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const { match_id } = body;
    const { data: match } = await supabase.from('matches').select('*').eq('id', match_id).single();
    if (!match) return resp(404, { error: 'Partido no encontrado' });

    // Obtener participantes que no han pronosticado
    const { data: pending } = await supabase
      .from('pending_predictions')
      .select('*')
      .eq('match_id', match_id);

    if (!pending || pending.length === 0) {
      return resp(200, { message: 'Todos han pronosticado', sent: 0 });
    }

    // Mensaje WhatsApp
    const whatsappMsg = generateWhatsappMessage(match, pending);

    // Enviar email a cada pendiente
    let sent = 0;
    for (const p of pending) {
      const { data: fullP } = await supabase.from('participants').select('*').eq('id', p.participant_id).single();
      if (!fullP) continue;
      const content = emailReminder(fullP, match);
      const result = await sendEmail({ to: fullP.email, ...content });
      await supabase.from('notifications').insert({
        participant_id: fullP.id,
        match_id: match.id,
        type: 'reminder_player',
        channel: 'email',
        success: result.success
      });
      if (result.success) sent++;
    }

    // Notificar a todos los admins
    const { data: admins } = await supabase.from('participants').select('*').eq('role','admin').eq('is_active',true);
    for (const admin of (admins || [])) {
      const content = emailAdminAlert(admin.name, match, pending, whatsappMsg);
      await sendEmail({ to: admin.email, ...content });
    }

    return resp(200, { sent, pending_count: pending.length, whatsapp_message: whatsappMsg });
  }

  // ── ADMIN: Reset completo (solo modo test) ─────────────────
  if (path === '/admin/reset' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });

    const { data: modeConfig } = await supabase.from('config').select('value').eq('key','mode').single();
    if (modeConfig?.value !== 'test') {
      return resp(400, { error: 'Reset solo disponible en modo test' });
    }

    // Borrar en orden por dependencias
    await supabase.from('points_detail').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('predictions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('participants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    // Resetear partidos de prueba
    await supabase.from('matches').update({ score_a: null, score_b: null, went_to_penalties: false, penalty_winner: null, status: 'scheduled' }).eq('is_test', true);

    return resp(200, { success: true, message: 'Base de datos limpiada. Lista para producción.' });
  }

  // ── ADMIN: Cambiar modo test/producción ───────────────────
  if (path === '/admin/config/mode' && method === 'POST') {
    const participant = await getParticipantByToken(token);
    if (!requireAdmin(participant)) return resp(403, { error: 'Solo admins' });
    const { mode } = body;
    if (!['test','production'].includes(mode)) return resp(400, { error: 'Modo inválido' });
    await supabase.from('config').update({ value: mode }).eq('key','mode');
    return resp(200, { success: true, mode });
  }

  // ── CRON: Verificar partidos próximos y enviar recordatorios ─
  // Esta ruta es llamada por Netlify Scheduled Functions cada minuto
  if (path === '/cron/reminders' && method === 'POST') {
    const cronSecret = event.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) return resp(401, { error: 'No autorizado' });

    const now = new Date();
    const in11min = new Date(now.getTime() + 11 * 60 * 1000);
    const in9min  = new Date(now.getTime() +  9 * 60 * 1000);

    // Partidos que inician en ~10 minutos
    const { data: upcoming } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'scheduled')
      .gte('kickoff_utc', in9min.toISOString())
      .lte('kickoff_utc', in11min.toISOString());

    for (const match of (upcoming || [])) {
      const { data: pending } = await supabase
        .from('pending_predictions')
        .select('*')
        .eq('match_id', match.id);

      if (!pending || pending.length === 0) continue;

      const whatsappMsg = generateWhatsappMessage(match, pending);

      for (const p of pending) {
        const { data: fullP } = await supabase.from('participants').select('*').eq('id', p.participant_id).single();
        if (!fullP) continue;
        // Evitar enviar duplicados
        const { data: already } = await supabase.from('notifications')
          .select('id').eq('participant_id', fullP.id).eq('match_id', match.id).eq('type','reminder_player').single();
        if (already) continue;

        const content = emailReminder(fullP, match);
        const result = await sendEmail({ to: fullP.email, ...content });
        await supabase.from('notifications').insert({
          participant_id: fullP.id, match_id: match.id,
          type: 'reminder_player', channel: 'email', success: result.success
        });
      }

      // Notificar admins
      const { data: admins } = await supabase.from('participants').select('*').eq('role','admin').eq('is_active',true);
      for (const admin of (admins || [])) {
        const content = emailAdminAlert(admin.name, match, pending, whatsappMsg);
        await sendEmail({ to: admin.email, ...content });
      }
    }

    // Bloquear partidos que ya iniciaron
    const { data: started } = await supabase
      .from('matches')
      .select('id')
      .eq('status', 'scheduled')
      .lte('kickoff_utc', now.toISOString());

    for (const m of (started || [])) {
      await supabase.rpc('lock_match_predictions', { p_match_id: m.id });
    }

    return resp(200, { checked: upcoming?.length || 0 });
  }

  // ── CRON: Sincronizar resultados con API-Football ──────────
  if (path === '/cron/sync-results' && method === 'POST') {
    const cronSecret = event.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) return resp(401, { error: 'No autorizado' });

    const { data: apiKeyConfig } = await supabase.from('config').select('value').eq('key','api_football_key').single();
    const apiKey = apiKeyConfig?.value;
    if (!apiKey) return resp(200, { message: 'API key no configurada — modo manual' });

    // Buscar partidos live o recién terminados
    const { data: liveMatches } = await supabase
      .from('matches')
      .select('*')
      .in('status', ['live', 'scheduled'])
      .not('api_match_id', 'is', null)
      .lte('kickoff_utc', new Date().toISOString());

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
        const goalsA = fixture.goals.home;
        const goalsB = fixture.goals.away;

        if (['FT','AET','PEN'].includes(status)) {
          const wentPenalties = status === 'PEN';
          let penaltyWinner = null;
          if (wentPenalties) {
            const penA = fixture.score.penalty.home;
            const penB = fixture.score.penalty.away;
            penaltyWinner = penA > penB ? match.team_a : match.team_b;
          }
          await supabase.from('matches').update({
            score_a: goalsA, score_b: goalsB,
            went_to_penalties: wentPenalties,
            penalty_winner: penaltyWinner,
            status: 'finished'
          }).eq('id', match.id);
          await supabase.rpc('calculate_match_points', { p_match_id: match.id });
          updated++;
        }
      } catch(e) {
        console.error('API sync error:', e);
      }
    }

    return resp(200, { updated });
  }

  return resp(404, { error: 'Ruta no encontrada' });
};
