const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const logoBytes = readFileSync(join(__dirname, '../assets/panda-email.png')).toString('base64');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const paragraph = (text) => `<p style="margin:0 0 20px">${escapeHtml(text)}</p>`;

function brandMail({ subject, html, branding = {}, attachments = [] }, contentId) {
  const { title = subject, category = '', preheader = '', action, test = false, lang = 'en' } = branding;
  const hu = lang === 'hu';
  const actionHtml = action ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 16px"><tr>
      <td bgcolor="#fcb040" style="border-radius:6px;mso-padding-alt:12px 20px">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;font-weight:bold;color:#231508;text-decoration:none">${escapeHtml(action.label)}</a>
      </td>
    </tr></table>
    <p style="font-size:13px;color:#59616e;margin:0">${hu ? 'Ha a gomb nem nyílik meg, használd' : 'If the button does not open, use'} <a href="${escapeHtml(action.url)}" style="color:#8a4608">${hu ? 'ezt a linket' : 'this link'}</a>.</p>` : '';

  return {
    attachments: [...attachments, { name: 'panda-logo.png', bytes: logoBytes, contentType: 'image/png', isInline: true, contentId }],
    html: `<!doctype html><html lang="${lang === 'hu' ? 'hu' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f2ed">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(test ? (hu ? 'Tesztlevél · ' : 'Test email · ') + preheader : preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f2ed"><tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border:1px solid #e5dfd5;font-family:Arial,sans-serif;color:#231f20">
<tr><td bgcolor="#fcfaf6" style="padding:20px 30px;border-bottom:4px solid #fcb040">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td><img src="cid:${contentId}" width="48" height="48" alt="" style="display:block;border:0"></td>
    <td style="padding-left:14px;font-size:23px;letter-spacing:.4px;color:#191612;font-weight:bold">PandA</td>
  </tr></table>
</td></tr>
${test ? `<tr><td bgcolor="#fff1da" style="padding:14px 30px;font-size:13px;color:#663909"><strong>${hu ? 'TESZTLEVÉL' : 'TEST EMAIL'}</strong> · ${hu ? 'Mintaadatok' : 'Sample data'}</td></tr>` : ''}
<tr><td bgcolor="#ffffff" style="padding:34px 30px;font-size:15px;line-height:1.6;overflow-wrap:anywhere">
  ${category ? `<p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#8a4608">${escapeHtml(category)}</p>` : ''}
  <h1 style="margin:0 0 22px;font-size:27px;line-height:1.22;color:#191612">${escapeHtml(title)}</h1>
  ${html || ''}${actionHtml}
</td></tr>
<tr><td bgcolor="#fcfaf6" style="padding:20px 30px;border-top:1px solid #e5dfd5;font-size:12px;line-height:1.5;color:#575048"><strong>PandA</strong> &copy; EPDS Szoftverfejlesztő Kft.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
  };
}

const accountTemplates = {
  'invite-password': { title: 'Your PandA invitation', action: 'Set your password', intro: 'You have been invited to PandA. Set a password to activate your account.' },
  'invite-microsoft': { title: 'Your PandA invitation', action: 'Connect Microsoft account', intro: 'You have been invited to PandA. Connect your Microsoft account to activate access.' },
  'invite-superadmin': { title: 'Your PandA SuperAdmin invitation', action: 'Set your password', intro: 'You have been invited to PandA as a SuperAdmin. Set your password to activate your account.' },
  'password-reset': { title: 'Reset your PandA password', action: 'Reset password', intro: 'Use the button below to choose a new password. If you did not request a reset, you can ignore this email.' },
  'account-recovery': { title: 'Recover your PandA account', action: 'Recover your account', intro: 'A SuperAdmin started account recovery for you. If you were not expecting this email, contact your administrator.' }
};

const accountTemplatesHu = {
  'invite-password': { title: 'PandA-meghívó', action: 'Jelszó beállítása', intro: 'Meghívást kaptál a PandA alkalmazásba. A fiókod aktiválásához állíts be jelszót.' },
  'invite-microsoft': { title: 'PandA-meghívó', action: 'Microsoft-fiók csatlakoztatása', intro: 'Meghívást kaptál a PandA alkalmazásba. A hozzáférés aktiválásához csatlakoztasd a Microsoft-fiókodat.' },
  'invite-superadmin': { title: 'PandA SuperAdmin-meghívó', action: 'Jelszó beállítása', intro: 'SuperAdmin szerepkörrel kaptál meghívást a PandA alkalmazásba. A fiókod aktiválásához állíts be jelszót.' },
  'password-reset': { title: 'PandA-jelszó visszaállítása', action: 'Jelszó visszaállítása', intro: 'Az alábbi gombbal új jelszót állíthatsz be. Ha nem te kérted a visszaállítást, figyelmen kívül hagyhatod ezt a levelet.' },
  'account-recovery': { title: 'PandA-fiók helyreállítása', action: 'Fiók helyreállítása', intro: 'Egy SuperAdmin elindította a fiókod helyreállítását. Ha váratlanul kaptad ezt a levelet, fordulj az adminisztrátorodhoz.' }
};

function accountMail(type, url, expiresIn, microsoft = false, language = 'en') {
  const hu = language === 'hu';
  const templates = hu ? accountTemplatesHu : accountTemplates;
  const { title, intro, action } = templates[type];
  const microsoftSuperAdmin = type === 'invite-superadmin' && microsoft;
  const introduction = microsoftSuperAdmin
    ? (hu ? 'SuperAdmin szerepkörrel kaptál meghívást a PandA alkalmazásba. A hozzáférés aktiválásához csatlakoztasd a Microsoft-fiókodat.'
      : 'You have been invited to PandA as a SuperAdmin. Connect your Microsoft account to activate access.')
    : intro;
  const microsoftHelp = hu
    ? 'A munkahelyi Microsoft-fiókodat használd, amellyel a munkahelyi Windowsba és más Microsoft-szolgáltatásokba is bejelentkezel.'
    : 'Use your company Microsoft account, the same one you use to sign in to Windows at work and other Microsoft services.';
  const expiry = hu
    ? `Ez az egyszer használható link ${expiresIn === '30 minutes' ? '30 perc' : '72 óra'} múlva lejár.`
    : `This single-use link expires in ${expiresIn}.`;
  return {
    subject: title,
    html: paragraph(introduction)
      + (type === 'invite-microsoft' || microsoftSuperAdmin ? paragraph(microsoftHelp) : '')
      + paragraph(expiry),
    branding: {
      lang: hu ? 'hu' : 'en',
      category: hu ? 'Fiókhozzáférés' : 'Account access',
      preheader: introduction,
      action: { label: microsoftSuperAdmin ? templates['invite-microsoft'].action : action, url }
    }
  };
}

function transitionMail(event, name, time, language = 'en') {
  const hu = language === 'hu';
  const down = event === 'down';
  const title = hu ? (down ? 'Szolgáltatáskiesés megerősítve' : 'A szolgáltatás helyreállt')
    : (down ? 'Service interruption confirmed' : 'Service restored');
  const description = hu
    ? (down ? 'Az ismételt mérések megerősítették, hogy a szolgáltatás nem elérhető.'
      : 'Az ismételt mérések megerősítették, hogy a szolgáltatás ismét elérhető.')
    : (down ? 'Repeated measurements confirmed that this service is unavailable.'
      : 'Repeated measurements confirmed that this service is available again.');
  const timestamp = new Intl.DateTimeFormat(hu ? 'hu-HU' : 'en-GB', {
    timeZone: 'Europe/Budapest', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(time));
  return {
    subject: `${title}: ${name}`,
    html: `<p style="margin:0 0 20px"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(timestamp)} (Budapest)</p>${paragraph(description)}`,
    branding: { title, category: hu ? 'Domainfigyelés' : 'Domain Health', preheader: description, lang: language }
  };
}

function monthlyReportMail(month, language = 'en') {
  const hu = language === 'hu';
  const title = hu ? 'Havi szolgáltatási jelentés' : 'Monthly service report';
  return {
    subject: `${title} – ${month}`,
    html: paragraph(`${hu ? 'Jelentési időszak' : 'Reporting period'}: ${month}`)
      + paragraph(hu ? 'A mellékelt PDF a rendelkezésre állást, a mérési lefedettséget, a kieséseket és a helyreállási időket mutatja be.'
        : 'The attached PDF covers service availability, measurement coverage, interruptions and recovery times.'),
    branding: { title, category: hu ? 'Domainfigyelés' : 'Domain Health', lang: language,
      preheader: hu ? 'A havi szolgáltatási jelentést PDF-ben mellékeltük.' : 'Your monthly service report is attached as a PDF.' }
  };
}

function forwardedMail(comment, originalHtml) {
  return {
    subject: 'Forwarded message',
    html: (comment ? `<p style="margin:0 0 20px">${escapeHtml(comment).replace(/\r?\n/g, '<br>')}</p>` : '')
      + `<div style="border-top:1px solid #e5dfd5;padding-top:16px">${originalHtml}</div>`,
    branding: { category: 'Mailbox', preheader: 'A message was forwarded from PandA.' }
  };
}

module.exports = { brandMail, escapeHtml, paragraph, accountMail, transitionMail, monthlyReportMail, forwardedMail };
