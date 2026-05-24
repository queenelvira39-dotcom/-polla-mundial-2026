// netlify/functions/scheduled-reminders.js
// Cron job: se ejecuta cada minuto
// Envía recordatorios 10 min antes del partido y bloquea pronósticos al inicio

const { schedule } = require('@netlify/functions');

const handler = async () => {
  try {
    const baseUrl = process.env.APP_BASE_URL || 'https://polla2026.netlify.app';
    const res = await fetch(`${baseUrl}/.netlify/functions/api/cron/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET
      }
    });
    const data = await res.json();
    console.log('[CRON reminders]', data);
    return { statusCode: 200 };
  } catch (e) {
    console.error('[CRON reminders] Error:', e);
    return { statusCode: 500 };
  }
};

exports.handler = schedule('* * * * *', handler);
