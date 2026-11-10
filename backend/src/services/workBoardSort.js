const { WORK_STATUSES } = require('../models/workItem');
const workFields = require('./workFields');

const catalogs = { entityId: 'entities', serviceTypeId: 'serviceTypes' };
const fixedColumns = ['workNumber', 'name', 'responsible', 'status', 'deadline', 'totalAmount', 'subWorkCount'];

async function workBoardSort(tenantId, { sort, direction }) {
  const descending = direction === 'desc';
  if (fixedColumns.includes(sort)) {
    return { key: sort, descending: descending || (sort === 'workNumber' && direction !== 'asc') };
  }
  if (typeof sort === 'string' && (Object.hasOwn(catalogs, sort) || sort.startsWith('field:'))) {
    const config = await workFields.settings(tenantId);
    if (Object.hasOwn(catalogs, sort)) return { key: sort, descending, options: config[catalogs[sort]] };
    const field = config.fields.find((entry) => entry.id === sort.slice(6) && entry.showInList && !entry.archived);
    if (field) return { key: 'field', descending, field, statuses: WORK_STATUSES.filter((status) => workFields.relevant(field, status)) };
  }
  return { key: 'workNumber', descending: true };
}

const optionLabels = (options) => Object.fromEntries(options.map(({ id, label }) => [id, label]));

function pgOrderBy(sort, params, deleted) {
  const { key, descending, field, options, statuses } = sort;
  const direction = descending ? 'DESC' : 'ASC';
  if (key === 'workNumber') return `w.year ${direction}, w.sequence_number ${direction}`;
  const bind = (value) => { params.push(value); return `$${params.length}`; };
  const text = (value) => `NULLIF(lower(${value}), '')`;
  const number = (value) => `CASE WHEN jsonb_typeof(${value}) = 'number' THEN (${value})::numeric END`;
  let expression;
  switch (key) {
    case 'name': expression = text('w.name'); break;
    case 'responsible': expression = text('w.responsible'); break;
    case 'status': expression = deleted ? 'NULL::text' : 'w.status'; break;
    case 'deadline': expression = 'w.deadline'; break;
    case 'totalAmount': expression = "CASE WHEN w.status <> 'inquiry' THEN w.total_amount END"; break;
    case 'subWorkCount':
      expression = `(SELECT count(*) FROM sub_work_items s WHERE s.tenant_id=w.tenant_id AND s.work_item_id=w.id
        AND s.status<>'cancelled' AND ${deleted ? 's.archived_by_work_at IS NOT NULL' : 's.archived_at IS NULL'})`;
      break;
    case 'entityId':
    case 'serviceTypeId': {
      const column = key === 'entityId' ? 'entity_id' : 'service_type_id';
      expression = text(`${bind(JSON.stringify(optionLabels(options)))}::jsonb ->> w.${column}::text`);
      break;
    }
    case 'field': {
      const value = `(w.custom_fields -> ${bind(field.id)}::text)`;
      switch (field.type) {
        case 'integer':
        case 'decimal': expression = number(value); break;
        case 'amount': expression = number(`${value}->'amount'`); break;
        case 'file': expression = text(`${value}->>'name'`); break;
        case 'list': {
          const labels = `${bind(JSON.stringify(optionLabels(field.options)))}::jsonb`;
          expression = text(`(SELECT string_agg(${labels} ->> option_id, ', ' ORDER BY position)
            FROM jsonb_array_elements_text(CASE jsonb_typeof(${value})
              WHEN 'array' THEN ${value} WHEN 'string' THEN jsonb_build_array(${value}) ELSE '[]'::jsonb END)
            WITH ORDINALITY AS selected(option_id, position))`);
          break;
        }
        default: expression = text(`${value} #>> '{}'`);
      }
      expression = `CASE WHEN w.status=ANY(${bind(statuses)}::text[]) THEN ${expression} END`;
    }
  }
  return `${expression} ${direction} NULLS LAST, w.year DESC, w.sequence_number DESC`;
}

function mongoSortStages({ key, descending, field, options, statuses }, subWorkCollection, deleted) {
  const direction = descending ? -1 : 1;
  if (key === 'workNumber') return [{ $sort: { year: direction, sequenceNumber: direction } }];
  const text = (value) => ({ $toLower: value });
  const number = (value) => ({ $cond: [{ $isNumber: value }, value, null] });
  const label = (value, choices) => choices.length ? {
    $switch: { branches: choices.map(({ id, label }) => ({
      case: { $eq: [value, { $literal: id }] }, then: { $literal: label }
    })), default: null }
  } : null;
  let value;
  const stages = [];
  switch (key) {
    case 'name': value = text('$name'); break;
    case 'responsible': value = text('$responsible'); break;
    case 'status': value = deleted ? null : '$status'; break;
    case 'deadline': value = '$deadline'; break;
    case 'totalAmount': value = { $cond: [{ $ne: ['$status', 'inquiry'] }, '$totalAmount', null] }; break;
    case 'subWorkCount':
      stages.push({ $lookup: {
        from: subWorkCollection, localField: '_id', foreignField: 'workItemId', let: { tenant: '$tenantId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$tenantId', '$$tenant'] }, status: { $ne: 'cancelled' },
            [deleted ? 'archivedByWorkAt' : 'archivedAt']: { $exists: deleted } } },
          { $count: 'total' }
        ],
        as: 'sortChildren'
      } });
      value = { $ifNull: [{ $arrayElemAt: ['$sortChildren.total', 0] }, 0] };
      break;
    case 'entityId':
    case 'serviceTypeId': value = text(label('$' + key, options)); break;
    case 'field': {
      const path = '$customFields.' + field.id;
      switch (field.type) {
        case 'integer':
        case 'decimal': value = number(path); break;
        case 'amount': value = number(path + '.amount'); break;
        case 'file': value = text(path + '.name'); break;
        case 'list': value = text({ $reduce: {
          input: { $cond: [{ $isArray: path }, path, [path]] },
          initialValue: '',
          in: { $let: { vars: { label: label('$$this', field.options) }, in: {
            $cond: [
              { $eq: ['$$label', null] }, '$$value',
              { $concat: ['$$value', { $cond: [{ $eq: ['$$value', ''] }, '', ', '] }, '$$label'] }
            ]
          } } }
        } }); break;
        case 'boolean': value = { $cond: [{ $eq: [{ $type: path }, 'bool'] }, path, null] }; break;
        default: value = { $cond: [{ $eq: [{ $type: path }, 'string'] }, text(path), null] };
      }
      value = { $cond: [{ $in: ['$status', statuses] }, value, null] };
    }
  }
  return [...stages, { $set: { sortValue: value } },
    { $set: { sortMissing: { $in: [{ $ifNull: ['$sortValue', null] }, [null, '']] } } },
    { $sort: { sortMissing: 1, sortValue: direction, year: -1, sequenceNumber: -1 } }];
}

module.exports = { workBoardSort, pgOrderBy, mongoSortStages };
