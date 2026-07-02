const { getGraphClient } = require('./graphClient');
const { fetch } = require('undici');

class GraphMailService {
  constructor() {
    this.client = getGraphClient();
    this.defaultSender = process.env.MAIL_SENDER_UPN;
    this.saveToSent = String(process.env.MAIL_SAVE_TO_SENT || 'true').toLowerCase() === 'true';
    this.inlineLogo = String(process.env.MAIL_INLINE_LOGO || 'false').toLowerCase() === 'true';
    this.inlineLogoTimeoutMs = Number(process.env.MAIL_INLINE_LOGO_TIMEOUT_MS || 5000);
  }

  static logoCache = new Map();

  recipients(list) {
    return (Array.isArray(list) ? list : [list])
      .map((address) => String(address || '').trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));
  }

  attachment({ name, bytes, contentType, isInline, contentId }) {
    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name,
      contentType: contentType || 'application/octet-stream',
      contentBytes: bytes,
      ...(isInline ? { isInline: true } : {}),
      ...(contentId ? { contentId: String(contentId) } : {})
    };
  }

  async fetchBase64(url, timeoutMs) {
    const cached = GraphMailService.logoCache.get(url);
    if (cached) return cached;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const bytesBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
      const record = {
        bytesBase64,
        contentType: res.headers.get('content-type') || 'application/octet-stream',
        name: url.split('/').pop() || 'inline.bin'
      };
      GraphMailService.logoCache.set(url, record);
      return record;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async maybeInlineLogo({ html, attachments }) {
    if (!this.inlineLogo) return { html, attachments };
    const inputHtml = String(html || '');
    const logoUrl = [
      'https://certs.atexdb.eu/public/index_logo.png',
      'https://certs.atexdb.eu/public/ATEXdb.png'
    ].find((url) => inputHtml.includes(url));
    if (!logoUrl) return { html, attachments };

    const logo = await this.fetchBase64(logoUrl, this.inlineLogoTimeoutMs);
    if (!logo) return { html, attachments };

    const contentId = 'tenant-logo';
    return {
      html: inputHtml.split(logoUrl).join(`cid:${contentId}`),
      attachments: [
        ...(attachments || []),
        { name: logo.name, bytes: logo.bytesBase64, contentType: logo.contentType, isInline: true, contentId }
      ]
    };
  }

  async sendMail({ to, subject, html, from, cc = [], bcc = [], attachments = [] }) {
    const sender = from || this.defaultSender;
    if (!sender) throw new Error('MAIL_SENDER_UPN is not set');
    const final = await this.maybeInlineLogo({ html, attachments });
    const message = {
      subject: subject || '',
      body: { contentType: 'HTML', content: final.html || '' },
      toRecipients: this.recipients(to),
      ...(cc.length ? { ccRecipients: this.recipients(cc) } : {}),
      ...(bcc.length ? { bccRecipients: this.recipients(bcc) } : {}),
      ...(final.attachments.length ? { attachments: final.attachments.map((a) => this.attachment(a)) } : {})
    };
    await this.client.api(`/users/${encodeURIComponent(sender)}/sendMail`).post({
      message,
      saveToSentItems: this.saveToSent
    });
  }

  async listMailboxMessages({ folder = 'inbox', top = 25, skip = 0 } = {}) {
    const sender = this.defaultSender;
    if (!sender) throw new Error('MAIL_SENDER_UPN is not set');
    const normalizedFolder = String(folder || 'inbox').trim().toLowerCase();
    if (!new Set(['inbox', 'sentitems']).has(normalizedFolder)) throw new Error('Unsupported folder');
    const resp = await this.client
      .api(`/users/${encodeURIComponent(sender)}/mailFolders/${normalizedFolder}/messages`)
      .select('id,subject,from,sender,toRecipients,receivedDateTime,sentDateTime,isRead,importance,bodyPreview,hasAttachments,conversationId')
      .top(Math.min(Math.max(Number(top) || 25, 1), 100))
      .skip(Math.max(Number(skip) || 0, 0))
      .orderby('receivedDateTime DESC')
      .get();
    return Array.isArray(resp?.value) ? resp.value : [];
  }

  async getMailboxMessage(id) {
    const sender = this.defaultSender;
    if (!sender) throw new Error('MAIL_SENDER_UPN is not set');
    return this.client
      .api(`/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(String(id))}`)
      .select('id,subject,from,sender,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,importance,bodyPreview,hasAttachments,body,internetMessageId,conversationId')
      .get();
  }
}

module.exports = new GraphMailService();
