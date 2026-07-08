const path = require('path');
const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 28;
const FOOTER_HEIGHT = 18;
const CARD_RADIUS = 10;
const FOOTER_TEXT = 'EPDS Software Development Ltd.';
const LOGO_IMAGE_PATH = path.resolve(__dirname, '../../../frontend/public/EPDSlogo.png');
const COLORS = {
  page: '#f6efe3',
  panel: '#fffdf9',
  card: '#f8fafc',
  border: '#d9dee8',
  ink: '#101828',
  muted: '#667085',
  brand: '#a75c17',
  ok: '#047857',
  okBg: '#ecfdf3',
  warning: '#b45309',
  warningBg: '#fffbeb',
  error: '#b91c1c',
  errorBg: '#fef2f2',
  unknown: '#cfd8e6',
  historyUnknown: '#d7dfec'
};

function formatDate(value, options = {}) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: options.withTime === false ? undefined : 'short',
    hour12: false
  }).format(new Date(value));
}


function statusLabel(status) {
  if (status === 'error') return 'Down';
  if (status === 'warning') return 'Warning';
  if (status === 'ok') return 'Healthy';
  return 'Unknown';
}

function msText(value) {
  return typeof value === 'number' ? `${Math.round(value)} ms` : '-';
}

function scoreText(value) {
  return typeof value === 'number' ? String(value) : '-';
}

function uptimeText(value) {
  return typeof value === 'number' ? `${value}%` : '-';
}

function shortText(value, max = 46) {
  const text = String(value || '-');
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function tlsText(daysRemaining) {
  if (typeof daysRemaining !== 'number') return '-';
  if (daysRemaining <= 0) return 'Expired';
  return `${daysRemaining}d`;
}

function incidentDurationText(durationMs) {
  const minutes = Math.round((durationMs || 0) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function statusColors(status) {
  if (status === 'error') return { fg: COLORS.error, bg: COLORS.errorBg };
  if (status === 'warning') return { fg: COLORS.warning, bg: COLORS.warningBg };
  if (status === 'ok') return { fg: COLORS.ok, bg: COLORS.okBg };
  return { fg: COLORS.muted, bg: '#eef2f7' };
}

function lcpColor(status) {
  if (status === 'good') return COLORS.ok;
  if (status === 'needs improvement') return COLORS.warning;
  if (status === 'poor') return COLORS.error;
  return COLORS.ink;
}

function lcpLabel(status) {
  if (status === 'good') return 'Good';
  if (status === 'needs improvement') return 'Needs improvement';
  if (status === 'poor') return 'Poor';
  return 'Unknown';
}

function drawPageChrome(doc) {
  doc.save();
  const gradient = doc.linearGradient(0, 0, doc.page.width, doc.page.height);
  gradient.stop(0, '#fff1d8');
  gradient.stop(0.18, '#f9ecd7');
  gradient.stop(0.52, '#f7f2e8');
  gradient.stop(1, '#f4efe6');
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(gradient);
  doc.restore();
}

function drawFooter(doc) {
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(
    FOOTER_TEXT,
    0,
    doc.page.height - PAGE_MARGIN - 10,
    { width: doc.page.width, align: 'center', lineBreak: false }
  );
}

function drawBrandLogo(doc, x, y, width = 50) {
  try {
    doc.image(LOGO_IMAGE_PATH, x, y, { width });
  } catch (_error) {
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(12).text('EPDS', x, y + 4);
  }
}

function addPage(doc) {
  doc.addPage();
  drawPageChrome(doc);
  drawFooter(doc);
}

function ensureSpace(doc, y, neededHeight) {
  const maxY = doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT;
  if (y + neededHeight <= maxY) return y;
  addPage(doc);
  return PAGE_MARGIN;
}

function drawRoundedPanel(doc, x, y, w, h, fill = COLORS.panel, stroke = COLORS.border) {
  doc.save();
  doc.roundedRect(x, y, w, h, CARD_RADIUS).fillAndStroke(fill, stroke);
  doc.restore();
}

function drawMetricCard(doc, x, y, w, h, label, value, accentColor = COLORS.ink, options = {}) {
  const labelSize = options.labelSize || 10;
  const valueSize = options.valueSize || 19;
  const valueY = options.valueY || 32;
  drawRoundedPanel(doc, x, y, w, h, COLORS.card, COLORS.border);
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(labelSize).text(label, x + 12, y + 12, { width: w - 24 });
  doc.fillColor(accentColor).font('Helvetica-Bold').fontSize(valueSize).text(value, x + 12, y + valueY, {
    width: w - 24,
    height: h - valueY - 8
  });
}

function drawStatusPill(doc, x, y, text, status) {
  const { fg, bg } = statusColors(status);
  const width = 88;
  doc.save();
  doc.roundedRect(x, y, width, 22, 11).fillAndStroke(bg, fg);
  doc.restore();
  doc.fillColor(fg).font('Helvetica-Bold').fontSize(9).text(text, x, y + 6, { width, align: 'center' });
}

function drawHistoryStrip(doc, x, y, width, history) {
  const gap = 3;
  const count = Math.max(history.length, 1);
  const segmentWidth = (width - gap * (count - 1)) / count;
  history.forEach((bucket, index) => {
    const color = bucket.status === 'ok'
      ? COLORS.ok
      : bucket.status === 'warning'
        ? COLORS.warning
        : bucket.status === 'error'
          ? COLORS.error
          : COLORS.historyUnknown;
    const left = x + index * (segmentWidth + gap);
    doc.save();
    doc.roundedRect(left, y, segmentWidth, 12, 4).fill(color);
    doc.restore();
  });
}

function chartMaxMs(history = []) {
  const values = history.map((bucket) => {
    if (bucket.status === 'error') return 10000;
    return typeof bucket.responseMs === 'number' ? Math.max(bucket.responseMs, 1) : 0;
  });
  const max = Math.max(...values, 5000);
  return Math.ceil(max / 1000) * 1000;
}

function drawResponseChart(doc, x, y, width, height, history = []) {
  drawRoundedPanel(doc, x, y, width, height, COLORS.card, COLORS.border);
  const left = x + 34;
  const right = x + width - 16;
  const top = y + 18;
  const bottom = y + height - 20;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const maxMs = chartMaxMs(history);
  const values = history.map((bucket) => {
    if (bucket.status === 'error') return maxMs;
    return typeof bucket.responseMs === 'number' ? Math.max(bucket.responseMs, 1) : null;
  });
  const points = values
    .map((value, index) => {
      if (value === null) return null;
      const xPos = left + (index / Math.max(values.length - 1, 1)) * plotWidth;
      const yPos = bottom - (Math.min(value, maxMs) / maxMs) * plotHeight;
      const status = history[index]?.status || 'unknown';
      return { x: xPos, y: yPos, status };
    })
    .filter(Boolean);

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('24h response trend', x + 14, y + 10);

  const ticks = [0, Math.round(maxMs / 2), maxMs];
  ticks.forEach((tick) => {
    const yPos = bottom - (tick / maxMs) * plotHeight;
    doc.save();
    doc.moveTo(left, yPos).lineTo(right, yPos).strokeColor('#e7ebf2').lineWidth(1).stroke();
    doc.restore();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(
      tick === 0 ? '0' : tick >= 1000 ? `${Math.round(tick / 1000)}s` : `${tick} ms`,
      x + 6,
      yPos - 4,
      { width: 24, align: 'right' }
    );
  });

  if (points.length > 1) {
    doc.save();
    doc.lineWidth(1.8).strokeColor('#44638f');
    points.forEach((point, index) => {
      if (index === 0) doc.moveTo(point.x, point.y);
      else doc.lineTo(point.x, point.y);
    });
    doc.stroke();
    doc.restore();
  }

  points.forEach((point) => {
    const color = point.status === 'error' ? COLORS.error : point.status === 'warning' ? COLORS.warning : COLORS.ok;
    doc.save();
    doc.circle(point.x, point.y, 2.2).fill(color);
    doc.restore();
  });
}

function drawIncidentRow(doc, x, y, width, incident) {
  const rowHeight = 28;
  doc.save();
  doc.moveTo(x, y).lineTo(x + width, y).stroke(COLORS.border);
  doc.restore();

  const badgeText = incident.severity === 'error' ? 'Down' : 'Warning';
  const { fg, bg } = statusColors(incident.severity);
  const badgeWidth = 68;
  doc.save();
  doc.roundedRect(x, y + 5, badgeWidth, 18, 9).fillAndStroke(bg, fg);
  doc.restore();
  doc.fillColor(fg).font('Helvetica-Bold').fontSize(8).text(badgeText, x, y + 10,
  {
    width: badgeWidth,
    align: 'center'
  });

  const textX = x + badgeWidth + 10;
  const textWidth = width - (badgeWidth + 10);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text(incident.reasonText, textX, y + 4, {
    width: textWidth,
    lineGap: 0
  });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(
    `${formatDate(incident.startedAt)} - ${incident.endedAt ? formatDate(incident.endedAt) : 'Open'} · ${incidentDurationText(incident.durationMs)}`,
    textX,
    y + 16,
    { width: textWidth, lineGap: 0 }
  );
  return rowHeight;
}

function drawGuideItem(doc, x, y, width, title, text) {
  drawRoundedPanel(doc, x, y, width, 34, COLORS.card, COLORS.border);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(8.5).text(title, x + 9, y + 7, {
    width: width - 24,
    lineBreak: false
  });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.2).text(text, x + 9, y + 18, {
    width: width - 18,
    height: 12,
    lineGap: 0
  });
}

function drawGuideSection(doc, x, y, width, title, items) {
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(title, x, y);
  let nextY = y + 17;
  items.forEach(([itemTitle, text]) => {
    drawGuideItem(doc, x, nextY, width, itemTitle, text);
    nextY += 40;
  });
  return nextY + 10;
}

function drawExplanationPage(doc, report) {
  addPage(doc);
  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  drawBrandLogo(doc, PAGE_MARGIN + pageWidth - 86, y, 86);
  doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(12).text('REPORT GUIDE', PAGE_MARGIN, y + 4);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(28).text('How to read this report', PAGE_MARGIN, y + 22, {
    width: pageWidth - 120
  });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10).text(
    `This guide explains the status and performance metrics used in the ${report.owner === 'All' ? 'domain' : report.owner} availability report.`,
    PAGE_MARGIN,
    y + 62,
    { width: pageWidth - 120 }
  );
  y += 98;

  const leftX = PAGE_MARGIN;
  const gap = 16;
  const colW = (pageWidth - gap) / 2;
  const rightX = leftX + colW + gap;

  let leftY = y;
  leftY = drawGuideSection(doc, leftX, leftY, colW, 'Overall status', [
    ['Domains', 'Number of active monitored domains included in this report.'],
    ['Healthy', 'Domains that are currently available with no active warning.'],
    ['Warnings', 'Available domains with a recent issue, slow response, or certificate warning.'],
    ['Down', 'Domains that are currently failing checks and may not be reachable.']
  ]);
  drawGuideSection(doc, leftX, leftY, colW, 'Availability and response time', [
    ['30d uptime', 'Percentage of successful checks during the last 30 days. Higher is better.'],
    ['30d avg', 'Average response time during successful checks. Lower is better.'],
    ['30d P95', '95% of successful checks were faster than this value. Shows slow outliers.'],
    ['30d incidents', 'Number of warning or outage periods detected in the last 30 days.'],
    ['24 hour status history', 'Green means healthy, orange warning, red down, grey no data.']
  ]);

  let rightY = y;
  rightY = drawGuideSection(doc, rightX, rightY, colW, 'Security and PageSpeed', [
    ['TLS', 'Days remaining until the HTTPS certificate expires.'],
    ['Valid to', 'The date when the current HTTPS certificate expires.'],
    ['Mobile performance', 'Latest Google PageSpeed performance score for mobile. 90+ is good.'],
    ['Desktop performance', 'Latest Google PageSpeed performance score for desktop. 90+ is good.'],
    ['7d trend', 'Change in the latest mobile score compared with the previous 7 day result.'],
    ['LCP', 'Largest Contentful Paint: how quickly the main visible content loads.'],
    ['Main issue', 'Most relevant PageSpeed improvement opportunity detected for the website.']
  ]);
  drawGuideSection(doc, rightX, rightY, colW, 'Incidents', [
    ['Last incident', 'Most recent detected problem or warning for this domain.'],
    ['Last successful check', 'Most recent check where the website responded successfully.'],
    ['Last failed check', 'Most recent check where the website was down or returned a critical error.'],
    ['Last recovery', 'Most recent time the website recovered after an outage.'],
    ['Recent incidents', 'Most recent incident periods, with root cause, time range, and duration.']
  ]);
}

function collectBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function generatePublicStatusPdf(report) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true
  });

  drawPageChrome(doc);
  drawFooter(doc);
  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  const logoWidth = 92;
  const logoX = PAGE_MARGIN + pageWidth - logoWidth;
  const heroY = y;
  const titleWidth = pageWidth - logoWidth - 32;

  doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(12).text('SERVICE STATUS', PAGE_MARGIN, heroY);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(36).text(
    report.owner === 'All' ? 'All Monitored Domains' : report.owner,
    PAGE_MARGIN,
    heroY + 18,
    { width: titleWidth }
  );

  drawBrandLogo(doc, logoX, heroY, logoWidth);
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(
    `Generated ${formatDate(report.generatedAt)}`,
    logoX,
    heroY + 38,
    { width: logoWidth, align: 'right' }
  );
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(11).text(
    '30 days availability and performance staus report.',
    PAGE_MARGIN,
    heroY + 60,
    { width: pageWidth - 180 }
  );
  y = heroY + 96;

  const summaryGap = 12;
  const summaryWidth = (pageWidth - summaryGap * 3) / 4;
  drawMetricCard(doc, PAGE_MARGIN, y, summaryWidth, 52, 'Domains', String(report.summary.domainCount), COLORS.ink, { valueSize: 16, valueY: 24 });
  drawMetricCard(doc, PAGE_MARGIN + (summaryWidth + summaryGap), y, summaryWidth, 52, 'Healthy', String(report.summary.okCount), COLORS.ok, { valueSize: 16, valueY: 24 });
  drawMetricCard(doc, PAGE_MARGIN + 2 * (summaryWidth + summaryGap), y, summaryWidth, 52, 'Warnings', String(report.summary.warningCount), COLORS.warning, { valueSize: 16, valueY: 24 });
  drawMetricCard(doc, PAGE_MARGIN + 3 * (summaryWidth + summaryGap), y, summaryWidth, 52, 'Down', String(report.summary.errorCount), COLORS.error, { valueSize: 16, valueY: 24 });
  y += 64;

  for (const [index, item] of report.domains.entries()) {
    const cardX = PAGE_MARGIN;
    const cardW = pageWidth;
    const incidentsToShow = item.overview.incidents.slice(0, 4);
    const cardH = incidentsToShow.length
      ? 480 + incidentsToShow.length * 28
      : 448;

    if (index === 0) {
      y = ensureSpace(doc, y, cardH);
    } else {
      addPage(doc);
      y = PAGE_MARGIN;
    }

    drawRoundedPanel(doc, cardX, y, cardW, cardH, COLORS.panel, COLORS.border);

    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(18).text(item.domain.name, cardX + 18, y + 14, { width: cardW - 140 });
    doc.fillColor('#1d4ed8').font('Helvetica').fontSize(10).text(item.domain.baseUrl, cardX + 18, y + 36, { width: cardW - 160 });
    drawStatusPill(doc, cardX + cardW - 106, y + 16, statusLabel(item.domain.displayStatus), item.domain.displayStatus);

    const metricsY = y + 58;
    const metricGap = 8;
    const metricCols = 3;
    const metricW = (cardW - 36 - metricGap * (metricCols - 1)) / metricCols;
    const metricH = 44;
    const metrics = [
      ['30d uptime', uptimeText(item.overview.windows[2]?.uptimePercent), COLORS.ink],
      ['30d avg', msText(item.overview.windows[2]?.avgResponseMs), COLORS.ink],
      ['30d P95', msText(item.overview.windows[2]?.p95ResponseMs), COLORS.ink],
      ['30d incidents', String(item.overview.windows[2]?.incidentCount ?? 0), COLORS.ink],
      ['TLS', tlsText(item.overview.tls.daysRemaining), item.overview.tls.status === 'error' ? COLORS.error : item.overview.tls.status === 'warning' ? COLORS.warning : COLORS.ink],
      ['Valid to', formatDate(item.overview.tls.validTo, { withTime: false }), COLORS.ink]
    ];
    metrics.forEach(([label, value, color], index) => {
      const col = index % metricCols;
      const row = Math.floor(index / metricCols);
      drawMetricCard(doc, cardX + 18 + col * (metricW + metricGap), metricsY + row * (metricH + metricGap), metricW, metricH, label, value, color, {
        labelSize: 8,
        valueSize: 11,
        valueY: 21
      });
    });

    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('24 hour status history', cardX + 18, y + 166);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(11).text(
      item.overview.currentIncident ? 'Incident open' : 'No current incident',
      cardX + cardW - 170,
      y + 166,
      { width: 150, align: 'right' }
    );
    drawHistoryStrip(doc, cardX + 18, y + 186, cardW - 36, item.overview.history24h);

    const pageSpeed = item.pageSpeed || {};
    const perfY = y + 214;
    const perfGap = 6;
    const perfCols = 4;
    const perfW = (cardW - 36 - perfGap * (perfCols - 1)) / perfCols;
    const performanceMetrics = [
      ['Mobile perf.', scoreText(pageSpeed.latestMobilePerformance), COLORS.ink],
      ['Desktop perf.', scoreText(pageSpeed.latestDesktopPerformance), COLORS.ink],
      ['7d trend', pageSpeed.trend7d || '-', COLORS.ink],
      ['LCP', lcpLabel(pageSpeed.lcpStatus), lcpColor(pageSpeed.lcpStatus)]
    ];
    performanceMetrics.forEach(([label, value, color], perfIndex) => {
      drawMetricCard(doc, cardX + 18 + perfIndex * (perfW + perfGap), perfY, perfW, 42, label, value, color, {
        labelSize: 8,
        valueSize: 10,
        valueY: 21
      });
    });
    drawMetricCard(doc, cardX + 18, perfY + 48, cardW - 36, 38, 'Main issue', shortText(pageSpeed.mainIssue || 'No PageSpeed result yet', 90), COLORS.ink, {
      labelSize: 8,
      valueSize: 10,
      valueY: 20
    });

    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Incidents', cardX + 18, y + 306);

    const detailY = y + 326;
    const detailCols = 2;
    const detailGap = 8;
    const detailW = (cardW - 36 - detailGap * (detailCols - 1)) / detailCols;
    const detailH = 48;
    const detailMetrics = [
      ['Last incident', item.overview.incidents[0]?.reasonText || 'No recent incident'],
      ['Last successful check', item.overview.lastSuccessfulCheck?.checkedAt ? formatDate(item.overview.lastSuccessfulCheck.checkedAt) : '-'],
      ['Last failed check', item.overview.lastFailedCheck?.checkedAt ? formatDate(item.overview.lastFailedCheck.checkedAt) : '-'],
      ['Last recovery', item.overview.lastRecoveryAt ? formatDate(item.overview.lastRecoveryAt) : '-']
    ];
    detailMetrics.forEach(([label, value], index) => {
      const col = index % detailCols;
      const row = Math.floor(index / detailCols);
      drawMetricCard(doc, cardX + 18 + col * (detailW + detailGap), detailY + row * (detailH + detailGap), detailW, detailH, label, value, COLORS.ink, {
        labelSize: 8,
        valueSize: 10,
        valueY: 22
      });
    });

    let incidentY = y + 442;
    if (incidentsToShow.length) {
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Recent incidents', cardX + 18, incidentY);
      incidentY += 16;
      incidentsToShow.forEach((incident) => {
        incidentY += drawIncidentRow(doc, cardX + 18, incidentY, cardW - 36, incident);
      });
    }

    y += cardH + 16;
  }

  drawExplanationPage(doc, report);

  return collectBuffer(doc);
}

module.exports = {
  generatePublicStatusPdf
};
