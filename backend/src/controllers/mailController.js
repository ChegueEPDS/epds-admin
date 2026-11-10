const mailService = require('../services/mailService');

exports.sendMail = async (req, res) => {
  try {
    const { to, subject, html, from, cc, bcc, attachments } = req.body || {};
    if (!to || !subject || !html) return res.status(400).json({ error: 'to, subject, html are required' });
    await mailService.sendMail({ to, subject, html, from, cc, bcc, attachments });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[mail] send failed:', err?.response?.data || err);
    return res.status(500).json({ error: 'Send failed', detail: err?.message });
  }
};

exports.listMailboxMessages = async (req, res) => {
  try {
    const folder = String(req.query?.folder || 'inbox').trim().toLowerCase();
    const top = Number(req.query?.top || 25);
    const skip = Number(req.query?.skip || 0);
    let page;
    if (req.query?.since !== undefined || req.query?.before !== undefined) {
      const since = new Date(String(req.query?.since || ''));
      const before = new Date(String(req.query?.before || ''));
      const span = before.getTime() - since.getTime();
      if (!(span > 0 && span <= 31 * 86400000)) {
        return res.status(400).json({ error: 'A valid mailbox date range of up to 31 days is required' });
      }
      page = await mailService.listMailboxMessagesInRange({ folder, since, before });
    } else {
      page = await mailService.listMailboxMessages({ folder, top, skip });
    }
    return res.json({ mailbox: process.env.MAIL_SENDER_UPN || null, folder, skip: Math.max(skip || 0, 0), ...page });
  } catch (err) {
    console.error('[mail] list mailbox failed:', err?.response?.data || err);
    return res.status(500).json({ error: 'Mailbox read failed', detail: err?.message || 'Unknown error' });
  }
};

exports.getMailboxMessage = async (req, res) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Message id is required' });
    const item = await mailService.getMailboxMessage(id);
    return res.json({ mailbox: process.env.MAIL_SENDER_UPN || null, item });
  } catch (err) {
    console.error('[mail] get mailbox message failed:', err?.response?.data || err);
    return res.status(500).json({ error: 'Mailbox message read failed', detail: err?.message || 'Unknown error' });
  }
};

exports.forwardMailboxMessage = async (req, res) => {
  try {
    const id = String(req.params?.id || '').trim();
    const { to, comment = '' } = req.body || {};
    if (!id || !Array.isArray(to) || !to.length ||
        to.some((address) => typeof address !== 'string' || !address.trim()) ||
        typeof comment !== 'string') {
      return res.status(400).json({ error: 'Message id, recipients and a valid optional comment are required' });
    }
    await mailService.forwardMailboxMessage(id, { to, comment });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[mail] forward failed:', err?.response?.data || err);
    return res.status(500).json({ error: 'Forward failed', detail: err?.message });
  }
};
