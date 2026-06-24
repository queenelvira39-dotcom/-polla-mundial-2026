// netlify/functions/scheduled-reminders.js
// Cron: cada 30 minutos — avisa 30 min antes de cada partido
const { schedule } = require('@netlify/functions');

const handler = async () => {
  try {
    const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/.netlify/functions/api/cron/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET }
    });
    const data = await res.json();
    console.log('[CRON reminders]', data);
    return { statusCode: 200 };
  } catch (e) {
    console.error('[CRON reminders] Error:', e.message);
    return { statusCode: 500 };
  }
};

exports.handler = schedule('*/30 * * * *', handler);
