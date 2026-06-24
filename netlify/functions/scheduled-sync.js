// netlify/functions/scheduled-sync.js
// Cron: cada 20 minutos — sincroniza resultados finales (no en vivo)
const { schedule } = require('@netlify/functions');

const handler = async () => {
  try {
    const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/.netlify/functions/api/cron/sync-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET }
    });
    const data = await res.json();
    console.log('[CRON sync-results]', data);
    return { statusCode: 200 };
  } catch (e) {
    console.error('[CRON sync-results] Error:', e.message);
    return { statusCode: 500 };
  }
};

exports.handler = schedule('*/20 * * * *', handler);
