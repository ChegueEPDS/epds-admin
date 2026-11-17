const PDFDocument = require('pdfkit');
const path = require('path');
const { SAFE_REASONS } = require('./domainCustomerReportService');
const { TIME_ZONE } = require('./domainMonthlyMetrics');
const { drawPageChrome, drawBrandLogo } = require('./domainStatusPdfService');

const MARGIN = 34;
const GAP = 10;
const COLORS = {
  paper: '#fffdf9', ink: '#101828', muted: '#475467', border: '#d9dee8',
  brand: '#8e4a13', blue: '#305ac8', green: '#09664f', red: '#b93832',
  warning: '#934b0a', warningPaper: '#fff1d8', unknown: '#8493a7', track: '#edf0f5'
};
const date = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' });
const timestamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
const integer = new Intl.NumberFormat('en-GB');

function duration(value) {
  if (value == null) return '—';
  if (value > 0 && value < 60000) return '<1 min';
  const minutes = Math.round(value / 60000);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

function generateMonthlyPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true,
      info: { Title: `Monthly service report - ${report.month}`, Author: 'EPDS' } });
    doc.registerFont('Regular', path.join(__dirname, '../assets/fonts/DejaVuSans.ttf'));
    doc.registerFont('Bold', path.join(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf'));
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - 2 * MARGIN;
    const bottom = doc.page.height - 46;
    const month = monthName.format(new Date(report.from));
    let y = MARGIN;

    function text(value, x, top, { width: w = width, size = 9, bold = false, color = COLORS.ink, ...options } = {}) {
      doc.font(bold ? 'Bold' : 'Regular').fontSize(size).fillColor(color).text(value, x, top, { width: w, ...options });
    }

    function height(value, w, size, bold = false) {
      return doc.font(bold ? 'Bold' : 'Regular').fontSize(size).heightOfString(value, { width: w });
    }

    function panel(x, top, w, h, fill = COLORS.paper) {
      doc.roundedRect(x, top, w, h, 8).fillAndStroke(fill, COLORS.border);
    }

    function room(needed) {
      if (y + needed <= bottom) return false;
      doc.addPage();
      drawPageChrome(doc);
      text(`MONTHLY SERVICE REPORT  ·  ${month}`, MARGIN, MARGIN, { size: 9, bold: true, color: COLORS.brand });
      y = MARGIN + 24;
      return true;
    }

    function title(label) {
      text(label, MARGIN, y, { size: 12, bold: true });
      y += 20;
    }

    function summaryCards() {
      const domains = report.domains;
      const total = field => domains.reduce((sum, item) => sum + (item.metrics[field] || 0), 0);
      const cards = [
        [integer.format(domains.length), 'Monitored services', COLORS.blue],
        [integer.format(total('incidentCount')), 'Observed interruptions', COLORS.red],
        [duration(total('downMs')), 'Total service downtime', COLORS.ink]
      ];
      if (domains.length && domains.every(item => Number.isFinite(item.metrics.checkCount))) {
        cards.splice(1, 0, [integer.format(total('checkCount')), 'Confirmed checks', COLORS.green]);
      }
      const w = (width - (cards.length - 1) * GAP) / cards.length;
      cards.forEach(([value, label, color], index) => {
        const x = MARGIN + index * (w + GAP);
        panel(x, y, w, 53);
        text(value, x + 10, y + 8, { width: w - 20, size: 16, bold: true, color, ellipsis: true, height: 22 });
        text(label, x + 10, y + 32, { width: w - 20, size: 8, color: COLORS.muted });
      });
      y += 65;
    }

    function serviceSummary() {
      const label = 'Monthly service summary';
      const maxException = Math.max(1, ...report.domains.map(({ metrics }) => metrics.downMs + metrics.unknownMs));
      room(90);
      title(label);
      for (const item of report.domains) {
        const m = item.metrics;
        const nameWidth = width - 250;
        const nameHeight = Math.min(40, height(item.name, nameWidth, 11, true));
        const headHeight = Math.max(nameHeight, 14);
        const hasBar = m.downMs + m.unknownMs > 0;
        const h = headHeight + 26 + (hasBar ? 12 : 0) + (m.slowdownCount ? 17 : 0);
        if (room(h + 20)) title(label);
        panel(MARGIN, y, width, h);
        const x = MARGIN + 12;
        text(item.name, x, y + 8, { width: nameWidth, size: 11, bold: true, height: headHeight, ellipsis: true });
        const uptime = m.uptimePercent == null ? 'Availability unavailable' : `${m.uptimePercent}% availability`;
        text(`${uptime}  ·  ${m.coveragePercent}% coverage`, MARGIN + nameWidth + 18, y + 9,
          { width: width - nameWidth - 30, align: 'right', bold: true, size: 9, color: m.knownMs ? COLORS.green : COLORS.muted });
        let row = y + 10 + headHeight;
        if (hasBar) {
          const barWidth = width - 24;
          const down = barWidth * m.downMs / maxException;
          const unknown = barWidth * m.unknownMs / maxException;
          doc.rect(x, row, barWidth, 7).fill(COLORS.track);
          if (down > 0) doc.rect(x, row, down, 7).fill(COLORS.red);
          if (unknown > 0) doc.rect(x + down, row, unknown, 7).fill(COLORS.unknown);
          row += 12;
        }
        doc.circle(x + 3, row + 5, 2.5).fill(COLORS.red);
        text(`${duration(m.downMs)} downtime`, x + 10, row, { size: 8, width: 180, color: COLORS.muted });
        doc.circle(x + 194, row + 5, 2.5).fill(COLORS.unknown);
        text(`${duration(m.unknownMs)} without measurement`, x + 201, row, { size: 8, width: 220, color: COLORS.muted });
        if (m.slowdownCount) {
          const count = m.slowdownCount;
          const slowdown = `${count} ${count === 1 ? 'slowdown' : 'slowdowns'}  ·  ${duration(m.slowdownMs)} while available`;
          text(slowdown, x, row + 15, { size: 8, bold: true, color: COLORS.warning });
        }
        y += h + 6;
      }
      y += 5;
    }

    function dailyChart(item) {
      const chartWidth = width - 24;
      const chartTitle = `Daily P95 · ${item.name}`;
      const header = Math.min(30, height(chartTitle, chartWidth, 10, true));
      const h = header + 98;
      room(h);
      const x = MARGIN + 12;
      panel(MARGIN, y, width, h);
      text(chartTitle, x, y + 8, { width: chartWidth, size: 10, bold: true, height: header, ellipsis: true });
      const series = item.metrics.dailyP95;
      const dayCount = new Date(+new Date(report.to) - 1).toLocaleString('en-GB', { timeZone: TIME_ZONE, day: 'numeric' });
      const max = Math.max(...series.map(point => point.ms));
      const step = Math.max(1, Math.ceil(max / 3 / 50)) * 50;
      const chartX = x + 48;
      const chartY = y + header + 16;
      const plotWidth = chartWidth - 52;
      const plotHeight = 52;
      const dayX = day => chartX + (day - 1) * plotWidth / (Number(dayCount) - 1);
      const valueY = ms => chartY + plotHeight - ms / (3 * step) * plotHeight;
      for (const value of [0, step, 2 * step, 3 * step]) {
        const lineY = valueY(value);
        doc.lineWidth(.5).moveTo(chartX, lineY).lineTo(chartX + plotWidth, lineY).stroke(COLORS.border);
        text(`${value} ms`, x, lineY - 5, { width: 41, size: 7, align: 'right', color: COLORS.muted });
      }
      let previous;
      for (const point of series) {
        const px = dayX(point.day);
        const py = valueY(point.ms);
        if (previous?.day === point.day - 1) {
          doc.lineWidth(1.8).moveTo(dayX(previous.day), valueY(previous.ms)).lineTo(px, py).stroke(COLORS.blue);
        }
        doc.circle(px, py, 1.7).fill(COLORS.blue);
        previous = point;
      }
      doc.lineWidth(1);
      text('Day 1', chartX, chartY + plotHeight + 7, { size: 7, width: 48, color: COLORS.muted });
      text(`Day ${dayCount}`, chartX + plotWidth - 50, chartY + plotHeight + 7,
        { size: 7, width: 50, align: 'right', color: COLORS.muted });
      y += h + GAP;
    }

    function performance() {
      const measured = report.domains.filter(({ metrics }) => metrics.p95Ms != null);
      if (!measured.length) return;
      const chart = measured.find(({ metrics }) => metrics.dailyP95?.length);
      room(chart ? 155 : 56);
      title('Response times');
      if (chart) dailyChart(chart);
      for (const item of measured) {
        const { metrics: m } = item;
        const change = Number.isFinite(item.previousP95) ? m.p95Ms - item.previousP95 : null;
        const delta = change === null ? '' : change === 0 ? '  ·  P95 unchanged vs previous month'
          : `  ·  P95 ${Math.abs(change)} ms ${change < 0 ? 'faster' : 'slower'} vs previous month`;
        const line = `${m.averageMs} ms average  ·  ${m.p95Ms} ms monthly P95${delta}`;
        const nameHeight = Math.min(30, height(item.name, 130, 8, true));
        const h = Math.max(nameHeight, height(line, width - 146, 8)) + 6;
        if (room(h + 20)) title('Response times');
        text(item.name, MARGIN, y, { width: 130, size: 8, bold: true, height: nameHeight, ellipsis: true });
        text(line, MARGIN + 146, y, { width: width - 146, size: 8, color: COLORS.muted });
        y += h;
      }
      y += GAP;
    }

    function interruptions() {
      const events = report.domains.flatMap(item => (item.metrics.incidents || []).map(incident => ({ ...incident, name: item.name })))
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
      if (!events.length) {
        room(24);
        const observed = report.domains.some(item => item.metrics.knownMs > 0);
        text(observed ? 'No interruption was observed during measured time.' : 'No availability measurements were recorded.',
          MARGIN, y, { color: COLORS.muted });
        y += 23;
        return;
      }
      room(55);
      title('Observed interruptions');
      if (events.length > 2) {
        const longest = Math.max(...events.map(event => event.durationMs));
        text(`Longest interruption: ${duration(longest)}`, MARGIN, y, { size: 8, color: COLORS.muted });
        y += 15;
      }
      for (const event of events) {
        const headline = `${event.name}  ·  ${timestamp.format(new Date(event.startedAt))} – ${timestamp.format(new Date(event.endedAt))}  ·  ${duration(event.durationMs)}`;
        const reason = SAFE_REASONS[event.reasonCode] || 'A service interruption was detected.';
        const outcome = event.recovered ? 'Recovery confirmed.' : 'Recovery unconfirmed within the measured period.';
        const detail = `${reason} ${outcome}`;
        const headlineHeight = Math.min(30, height(headline, width - 16, 8, true));
        const h = headlineHeight + height(detail, width - 16, 8) + 11;
        if (room(h + 20)) title('Observed interruptions');
        doc.rect(MARGIN, y + 1, 2, h - 7).fill(COLORS.red);
        text(headline, MARGIN + 8, y, { width: width - 16, size: 8, bold: true, height: headlineHeight, ellipsis: true });
        text(detail, MARGIN + 8, y + headlineHeight + 2, { width: width - 16, size: 8, color: COLORS.muted });
        y += h;
      }
      y += 4;
    }

    function observations() {
      for (const { name, tls, pageSpeed } of report.domains) {
        const notes = [];
        if (tls) notes.push(['HTTPS certificate', `Last recorded expiry date: ${date.format(new Date(tls.validTo))}.`]);
        if (pageSpeed) {
          const lcp = Number.isFinite(pageSpeed.lcpMs)
            ? ` Main content appeared after ${(pageSpeed.lcpMs / 1000).toFixed(1)} s in the test.` : '';
          notes.push(['Mobile loading', `PageSpeed ${pageSpeed.score}/100 on ${date.format(new Date(pageSpeed.checkedAt))}.${lcp}`]);
        }
        if (!notes.length) continue;
        const cardWidth = (width - (notes.length - 1) * GAP) / notes.length;
        const w = cardWidth - 20;
        const cards = notes.map(([label, detail]) => {
          const heading = `${label} · ${name}`;
          const headingHeight = Math.min(32, height(heading, w, 9, true));
          return { heading, headingHeight, detail, h: headingHeight + height(detail, w, 8) + 15 };
        });
        const h = Math.max(...cards.map(card => card.h));
        room(h);
        cards.forEach(({ heading, headingHeight, detail }, index) => {
          const x = MARGIN + index * (cardWidth + GAP);
          panel(x, y, cardWidth, h, COLORS.warningPaper);
          text(heading, x + 10, y + 6, { width: w, size: 9, bold: true, color: COLORS.warning, height: headingHeight, ellipsis: true });
          text(detail, x + 10, y + headingHeight + 8, { width: w, size: 8, color: COLORS.muted });
        });
        y += h + 5;
      }
    }

    function guide() {
      const definitions = [
        ['Availability and coverage', 'Availability is the share of measured time the service was available. Coverage is the share of monitored time represented by checks, each covering at most 30 minutes.'],
        ['Average and P95', 'Both use successful checks. At least 95% of those checks responded within the P95 time. The chart leaves gaps on days without a successful response sample.'],
        ['Downtime and recovery', 'Downtime is summed across services. Recovery is confirmed by a subsequent successful check. Event times are shown in Budapest time.'],
        ['Slowdowns and missing time', 'A slowdown means an available service exceeded its response-time threshold. Time without a measurement is excluded from availability.']
      ];
      const column = (width - 3 * GAP) / 2;
      const heights = definitions.map(([label, value]) => height(label, column, 8, true) + height(value, column, 8) + 7);
      const first = Math.max(heights[0], heights[1]);
      const h = 30 + first + Math.max(heights[2], heights[3]);
      y += 5;
      room(h);
      panel(MARGIN, y, width, h);
      text('How to read this report', MARGIN + GAP, y + 7, { size: 10, bold: true });
      definitions.forEach(([label, value], index) => {
        const x = MARGIN + GAP + index % 2 * (column + GAP);
        const top = y + 24 + (index >= 2 ? first : 0);
        text(label, x, top, { width: column, size: 8, bold: true });
        text(value, x, top + height(label, column, 8, true), { width: column, size: 8, color: COLORS.muted });
      });
    }

    drawPageChrome(doc);
    drawBrandLogo(doc, MARGIN + width - 83, y + 1, 83);
    const heroWidth = width - 100;
    text('MONTHLY SERVICE REPORT', MARGIN, y, { width: heroWidth, size: 10, bold: true, color: COLORS.brand });
    y += 17;
    const heroHeight = Math.min(100, height(report.customer, heroWidth, 27, true));
    text(report.customer, MARGIN, y, { width: heroWidth, size: 27, bold: true, height: heroHeight, ellipsis: true });
    y += heroHeight + 4;
    text(month, MARGIN, y, { size: 11, color: COLORS.muted });
    y += 25;

    summaryCards();
    serviceSummary();
    performance();
    interruptions();
    observations();
    guide();

    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      doc.switchToPage(index);
      text(`EPDS  ·  ${month}  ·  ${index + 1} / ${pages.count}`, MARGIN, doc.page.height - 28,
        { size: 8, color: COLORS.muted, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { generateMonthlyPdf, duration };
