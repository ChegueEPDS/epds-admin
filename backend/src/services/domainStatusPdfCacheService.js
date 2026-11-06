const crypto = require('crypto');
const DomainStatusPdf = require('../models/domainStatusPdf');
const { generatePublicStatusPdf } = require('./domainStatusPdfService');
const { withJobLease } = require('./scheduledJobLeaseService');
const { databaseEngine } = require('../postgres');
const domainHealthRepository = require('../repositories/postgres/domainHealthRepository');

const configuredRetentionDays = Number(process.env.DOMAIN_STATUS_PDF_RETENTION_DAYS || 30);
const RETENTION_DAYS = Number.isFinite(configuredRetentionDays) ? Math.max(1, Math.floor(configuredRetentionDays)) : 30;
const DAY_MS = 24 * 60 * 60 * 1000;
let cleanupTimer;

function reportDate(report) {
  return new Date(report.generatedAt).toISOString().slice(0, 10);
}

function pdfEtag(buffer) {
  return `\"${crypto.createHash('sha256').update(buffer).digest('base64url')}\"`;
}

async function ensureDailyPdf(report) {
  const ownerSlug = report.ownerSlug || 'all';
  const date = reportDate(report);
  const existing = databaseEngine() === 'postgresql'
    ? await domainHealthRepository.findDailyPdf(ownerSlug, date)
    : await DomainStatusPdf.findOne({ ownerSlug, reportDate: date }).lean();
  if (existing) return existing;

  const leaseName = `domain-status-pdf:${ownerSlug}:${date}`;
  const result = await withJobLease(leaseName, 10 * 60 * 1000, async () => {
    const cached = databaseEngine() === 'postgresql'
      ? await domainHealthRepository.findDailyPdf(ownerSlug, date)
      : await DomainStatusPdf.findOne({ ownerSlug, reportDate: date }).lean();
    if (cached) return cached;
    const content = await generatePublicStatusPdf(report);
    const expiresAt = new Date(Date.parse(`${date}T00:00:00.000Z`) + RETENTION_DAYS * DAY_MS);
    if (databaseEngine() === 'postgresql') return domainHealthRepository.saveDailyPdf({
      ownerSlug, reportDate: date, reportGeneratedAt: new Date(report.generatedAt), content,
      size: content.length, etag: pdfEtag(content), expiresAt
    });
    return DomainStatusPdf.findOneAndUpdate(
      { ownerSlug, reportDate: date },
      { $setOnInsert: { reportGeneratedAt: new Date(report.generatedAt), content, size: content.length, etag: pdfEtag(content), expiresAt } },
      { upsert: true, new: true }
    ).lean();
  });
  if (result.acquired) return result.value;
  return databaseEngine() === 'postgresql'
    ? domainHealthRepository.findDailyPdf(ownerSlug, date)
    : DomainStatusPdf.findOne({ ownerSlug, reportDate: date }).lean();
}

async function getOrGeneratePdf(report) {
  const ownerSlug = report.ownerSlug || 'all';
  const cached = databaseEngine() === 'postgresql'
    ? await domainHealthRepository.latestPdf(ownerSlug)
    : await DomainStatusPdf.findOne({ ownerSlug }).sort({ reportGeneratedAt: -1 }).lean();
  if (cached) return { ...cached, cacheStatus: 'HIT' };
  const generated = await ensureDailyPdf(report);
  if (!generated) {
    const content = await generatePublicStatusPdf(report);
    return { content, size: content.length, etag: pdfEtag(content), reportDate: reportDate(report), cacheStatus: 'MISS' };
  }
  return { ...generated, cacheStatus: 'MISS' };
}

async function cleanupExpiredPdfs() {
  if (databaseEngine() === 'postgresql') return domainHealthRepository.cleanupPdfs();
  return DomainStatusPdf.deleteMany({ expiresAt: { $lte: new Date() } });
}

function startDomainStatusPdfMaintenance() {
  if (cleanupTimer) return;
  void cleanupExpiredPdfs().catch((error) => console.error('[domain-status-pdf] initial cleanup failed:', error.message));
  cleanupTimer = setInterval(() => {
    void withJobLease('domain-status-pdf-cleanup', 23 * 60 * 60 * 1000, cleanupExpiredPdfs, { holdOnSuccess: true })
      .catch((error) => console.error('[domain-status-pdf] cleanup failed:', error.message));
  }, DAY_MS);
  cleanupTimer.unref?.();
}

module.exports = { cleanupExpiredPdfs, ensureDailyPdf, getOrGeneratePdf, pdfEtag, startDomainStatusPdfMaintenance };
