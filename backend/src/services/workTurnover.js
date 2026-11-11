const DEFAULT_WORK_TURNOVER_DAY = '01-01';
const workCalendar = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit'
});

function isWorkTurnoverDay(value) {
  if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`2000-${value}`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(5, 10) === value;
}

function workTurnoverError({ workTurnoverDay, alignWorkSequence }) {
  if (workTurnoverDay !== undefined && !isWorkTurnoverDay(workTurnoverDay)) return 'Adj meg érvényes fordulónapot.';
  if (alignWorkSequence !== undefined && typeof alignWorkSequence !== 'boolean') return 'Érvénytelen sorszámigazítás.';
  return null;
}

function workPeriodStart(asOf, turnoverDay = DEFAULT_WORK_TURNOVER_DAY) {
  const dateInYear = (year) => {
    // February 29 rolls over on February 28 in non-leap years.
    if (turnoverDay === '02-29' && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) return `${year}-02-28`;
    return `${year}-${turnoverDay}`;
  };
  const year = Number(asOf.slice(0, 4));
  const start = dateInYear(year);
  return asOf >= start ? start : dateInYear(year - 1);
}

function alignedWorkYear(now, turnoverDay) {
  return Number(workPeriodStart(workCalendar.format(now), turnoverDay).slice(0, 4));
}

module.exports = { DEFAULT_WORK_TURNOVER_DAY, workCalendar, isWorkTurnoverDay, workTurnoverError, workPeriodStart, alignedWorkYear };
