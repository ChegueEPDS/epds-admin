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
const hungarian = {
  "MONTHLY SERVICE REPORT": "HAVI SZOLGÁLTATÁSI JELENTÉS",
  "Monitored services": "Figyelt szolgáltatások",
  "Observed interruptions": "Észlelt kiesések",
  "Total service downtime": "Összes kiesési idő",
  "Confirmed checks": "Megerősített ellenőrzések",
  "Monthly service summary": "Havi szolgáltatási összefoglaló",
  "Availability unavailable": "A rendelkezésre állás ismeretlen",
  "Response times": "Válaszidők",
  "No interruption was observed during measured time.": "A mért időszakban nem volt észlelt kiesés.",
  "No availability measurements were recorded.": "Nincs rögzített rendelkezésreállási mérés.",
  "A service interruption was detected.": "A rendszer szolgáltatáskiesést észlelt.",
  "Recovery confirmed.": "A helyreállás megerősítve.",
  "Recovery unconfirmed within the measured period.": "A mért időszakban a helyreállás nem igazolható.",
  "HTTPS certificate": "HTTPS-tanúsítvány",
  "Mobile loading": "Mobilos betöltés",
  "Availability and coverage": "Rendelkezésre állás és lefedettség",
  "Availability is the share of measured time the service was available. Coverage is the share of monitored time represented by checks, each covering at most 30 minutes.": "A rendelkezésre állás azt mutatja, a mért idő mekkora részében volt elérhető a szolgáltatás. A lefedettség a megfigyelt idő azon része, amelyet az egyenként legfeljebb 30 percet lefedő ellenőrzések képviselnek.",
  "Average and P95": "Átlag és P95",
  "Both use successful checks. At least 95% of those checks responded within the P95 time. The chart leaves gaps on days without a successful response sample.": "Mindkét érték sikeres ellenőrzéseken alapul. Ezek legalább 95%-a a P95 értékén belül válaszolt. Az ábra üresen hagyja azokat a napokat, amikor nem volt sikeres mérés.",
  "Downtime and recovery": "Kiesés és helyreállás",
  "Downtime is summed across services. Recovery is confirmed by a subsequent successful check. Event times are shown in Budapest time.": "A kiesési idő a szolgáltatások kieséseit összesíti. A helyreállást egy későbbi sikeres ellenőrzés igazolja. Az időpontok budapesti idő szerint szerepelnek.",
  "Slowdowns and missing time": "Lassulások és mérés nélküli idő",
  "A slowdown means an available service exceeded its response-time threshold. Time without a measurement is excluded from availability.": "Lassuláskor az elérhető szolgáltatás túllépte a válaszidő küszöbértékét. A mérés nélküli idő nem számít bele a rendelkezésre állásba.",
  "How to read this report": "Útmutató a jelentéshez",
  "The service returned an unsuccessful response.": "A szolgáltatás sikertelen választ adott.",
  "The service did not respond within the expected time.": "A szolgáltatás nem válaszolt a várt időn belül.",
  "The service address could not be resolved.": "A szolgáltatás címének feloldása sikertelen.",
  "The service could not be reached.": "A szolgáltatás nem volt elérhető.",
  "A secure connection could not be established.": "A biztonságos kapcsolat létrehozása sikertelen.",
  "The security certificate has expired.": "A biztonsági tanúsítvány lejárt.",
  "The security certificate will expire soon.": "A biztonsági tanúsítvány hamarosan lejár.",
  "The service is responding slowly.": "A szolgáltatás lassan válaszol.",
  "The service requires several redirects.": "A szolgáltatás több átirányítást igényel.",
  "The service could not be checked.": "A szolgáltatást nem sikerült ellenőrizni."
};

function duration(value) {
  if (value == null) return '—';
  if (value > 0 && value < 60000) return '<1 min';
  const minutes = Math.round(value / 60000);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

function generateMonthlyPdf(report, language = 'en') {
  const hu = language === 'hu';
  const t = (text) => hu ? (hungarian[text] ?? text) : text;
  const locale = hu ? 'hu-HU' : 'en-GB';
  const date = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, day: 'numeric', month: 'short' });
  const timestamp = new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const monthName = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
  const integer = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const span = (value) => hu ? duration(value).replace(/ min/g, ' perc').replace(/ h/g, ' óra') : duration(value);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true,
      info: { Title: `${t('MONTHLY SERVICE REPORT')} - ${report.month}`, Author: 'EPDS' } });
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
      text(`${t('MONTHLY SERVICE REPORT')}  ·  ${month}`, MARGIN, MARGIN, { size: 9, bold: true, color: COLORS.brand });
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
        [integer.format(domains.length), t('Monitored services'), COLORS.blue],
        [integer.format(total('incidentCount')), t('Observed interruptions'), COLORS.red],
        [span(total('downMs')), t('Total service downtime'), COLORS.ink]
      ];
      if (domains.length && domains.every(item => Number.isFinite(item.metrics.checkCount))) {
        cards.splice(1, 0, [integer.format(total('checkCount')), t('Confirmed checks'), COLORS.green]);
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
      const label = t('Monthly service summary');
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
        const uptime = m.uptimePercent == null ? t('Availability unavailable') : `${decimal.format(m.uptimePercent)}% ${hu ? 'rendelkezésre állás' : 'availability'}`;
        text(`${uptime}  ·  ${decimal.format(m.coveragePercent)}% ${hu ? 'lefedettség' : 'coverage'}`, MARGIN + nameWidth + 18, y + 9,
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
        text(`${span(m.downMs)} ${hu ? 'kiesés' : 'downtime'}`, x + 10, row, { size: 8, width: 180, color: COLORS.muted });
        doc.circle(x + 194, row + 5, 2.5).fill(COLORS.unknown);
        text(`${span(m.unknownMs)} ${hu ? 'mérés nélkül' : 'without measurement'}`, x + 201, row, { size: 8, width: 220, color: COLORS.muted });
        if (m.slowdownCount) {
          const count = m.slowdownCount;
          const slowdown = `${count} ${hu ? 'lassulás' : count === 1 ? 'slowdown' : 'slowdowns'}  ·  ${span(m.slowdownMs)} ${hu ? 'elérhető állapotban' : 'while available'}`;
          text(slowdown, x, row + 15, { size: 8, bold: true, color: COLORS.warning });
        }
        y += h + 6;
      }
      y += 5;
    }

    function dailyChart(item) {
      const chartWidth = width - 24;
      const chartTitle = `${hu ? 'Napi P95' : 'Daily P95'} · ${item.name}`;
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
      text(hu ? '1. nap' : 'Day 1', chartX, chartY + plotHeight + 7, { size: 7, width: 48, color: COLORS.muted });
      text(hu ? `${dayCount}. nap` : `Day ${dayCount}`, chartX + plotWidth - 50, chartY + plotHeight + 7,
        { size: 7, width: 50, align: 'right', color: COLORS.muted });
      y += h + GAP;
    }

    function performance() {
      const measured = report.domains.filter(({ metrics }) => metrics.p95Ms != null);
      if (!measured.length) return;
      const chart = measured.find(({ metrics }) => metrics.dailyP95?.length);
      room(chart ? 155 : 56);
      title(t('Response times'));
      if (chart) dailyChart(chart);
      for (const item of measured) {
        const { metrics: m } = item;
        const change = Number.isFinite(item.previousP95) ? m.p95Ms - item.previousP95 : null;
        const delta = change === null ? '' : change === 0 ? '  ·  P95 unchanged vs previous month'
          : `  ·  P95 ${Math.abs(change)} ms ${change < 0 ? (hu ? 'gyorsabb' : 'faster') : (hu ? 'lassabb' : 'slower')} ${hu ? 'az előző hónaphoz képest' : 'vs previous month'}`;
        const line = `${m.averageMs} ms ${hu ? 'átlag' : 'average'}  ·  ${m.p95Ms} ms ${hu ? 'havi P95' : 'monthly P95'}${delta}`;
        const nameHeight = Math.min(30, height(item.name, 130, 8, true));
        const h = Math.max(nameHeight, height(line, width - 146, 8)) + 6;
        if (room(h + 20)) title(t('Response times'));
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
        text(observed ? t('No interruption was observed during measured time.') : t('No availability measurements were recorded.'),
          MARGIN, y, { color: COLORS.muted });
        y += 23;
        return;
      }
      room(55);
      title(t('Observed interruptions'));
      if (events.length > 2) {
        const longest = Math.max(...events.map(event => event.durationMs));
        text(`${hu ? 'Leghosszabb kiesés' : 'Longest interruption'}: ${span(longest)}`, MARGIN, y, { size: 8, color: COLORS.muted });
        y += 15;
      }
      for (const event of events) {
        const headline = `${event.name}  ·  ${timestamp.format(new Date(event.startedAt))} – ${timestamp.format(new Date(event.endedAt))}  ·  ${span(event.durationMs)}`;
        const reason = t(SAFE_REASONS[event.reasonCode] || 'A service interruption was detected.');
        const outcome = event.recovered ? t('Recovery confirmed.') : t('Recovery unconfirmed within the measured period.');
        const detail = `${reason} ${outcome}`;
        const headlineHeight = Math.min(30, height(headline, width - 16, 8, true));
        const h = headlineHeight + height(detail, width - 16, 8) + 11;
        if (room(h + 20)) title(t('Observed interruptions'));
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
        if (tls) notes.push([t('HTTPS certificate'), `${hu ? 'Utolsó rögzített lejárati dátum' : 'Last recorded expiry date'}: ${date.format(new Date(tls.validTo))}.`]);
        if (pageSpeed) {
          const lcp = Number.isFinite(pageSpeed.lcpMs)
            ? (hu ? ` A fő tartalom ${decimal.format(Math.round(pageSpeed.lcpMs / 100) / 10)} mp után jelent meg.`
              : ` Main content appeared after ${(pageSpeed.lcpMs / 1000).toFixed(1)} s in the test.`) : '';
          notes.push([t('Mobile loading'), `PageSpeed ${pageSpeed.score}/100 ${hu ? '·' : 'on'} ${date.format(new Date(pageSpeed.checkedAt))}.${lcp}`]);
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
        [t('Availability and coverage'), t('Availability is the share of measured time the service was available. Coverage is the share of monitored time represented by checks, each covering at most 30 minutes.')],
        [t('Average and P95'), t('Both use successful checks. At least 95% of those checks responded within the P95 time. The chart leaves gaps on days without a successful response sample.')],
        [t('Downtime and recovery'), t('Downtime is summed across services. Recovery is confirmed by a subsequent successful check. Event times are shown in Budapest time.')],
        [t('Slowdowns and missing time'), t('A slowdown means an available service exceeded its response-time threshold. Time without a measurement is excluded from availability.')]
      ];
      const column = (width - 3 * GAP) / 2;
      const heights = definitions.map(([label, value]) => height(label, column, 8, true) + height(value, column, 8) + 7);
      const first = Math.max(heights[0], heights[1]);
      const h = 30 + first + Math.max(heights[2], heights[3]);
      y += 5;
      room(h);
      panel(MARGIN, y, width, h);
      text(t('How to read this report'), MARGIN + GAP, y + 7, { size: 10, bold: true });
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
    text(t('MONTHLY SERVICE REPORT'), MARGIN, y, { width: heroWidth, size: 10, bold: true, color: COLORS.brand });
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
