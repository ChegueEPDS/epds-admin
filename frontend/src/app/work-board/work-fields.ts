export const WORK_FIELD_CARDS = [
  { id: 'basic', label: 'Basic information' },
  { id: 'offer', label: 'Offer and schedule' },
  { id: 'execution', label: 'Execution' },
  { id: 'completion', label: 'Completion' },
  { id: 'invoice', label: 'Invoicing' },
  { id: 'reporting', label: 'Dashboard reporting' },
  { id: 'documents', label: 'Documents' }
] as const;
export type WorkFieldCard = typeof WORK_FIELD_CARDS[number]['id'];
export type WorkFieldOrder = Partial<Record<WorkFieldCard, string[]>>;
export type LayoutItem = { id: string; label: string; visible?: boolean; required?: boolean;
  fieldType?: string; editable?: boolean; tableVisible?: boolean };
export const WORK_TABLE_COLUMNS: ReadonlySet<string> = new Set([
  'workNumber', 'name', 'entityId', 'serviceTypeId', 'responsible', 'status', 'deadline', 'totalAmount', 'subWorkCount'
]);

const requiredWorkFields = new Set(['name', 'status', 'currency']);

export const WORK_CARD_FIELDS = {
  basic: { name: 'Name', client: 'Client', entityId: 'Entity', serviceTypeId: 'Service type',
    responsible: 'Responsible', status: 'Status', projectSize: 'Project size', description: 'Description' },
  offer: { totalAmount: 'Total value', currency: 'Currency', offerDate: 'Offer date', deadline: 'Deadline', paymentDays: 'Payment term' },
  execution: { cost: 'Cost', subcontractor: 'Subcontractor', contract: 'Contract', margin: 'Margin' },
  completion: { completionDate: 'Completion date', paymentDeadline: 'Invoice payment deadline', certificate: 'Performance certificate' },
  invoice: { invoiceNumber: 'Invoice number', invoiceDate: 'Invoice date', paidAt: 'Payment date', paymentDeadline: 'Payment deadline' },
  reporting: { backup: 'Backup', nextAction: 'Next action', actionDue: 'Action due date', paymentStatus: 'Payment status',
    invoiced: 'Invoiced amount', paid: 'Paid amount' },
  documents: {}
} satisfies Record<WorkFieldCard, Record<string, string>>;

export function cardLayout(card: WorkFieldCard, fields: WorkField[], hidden: ReadonlySet<string>): LayoutItem[] {
  const items = [
    ...Object.entries(WORK_CARD_FIELDS[card]).map(([id, label]) => ({ id, label, required: requiredWorkFields.has(id) })),
    ...fields.filter((field) => field.card === card && !field.archived)
      .map(({ id, label, required }) => ({ id, label, required }))
  ];
  return items.map((item) => ({ ...item, visible: item.required || !hidden.has(item.id) }));
}

export function orderLayout<T extends LayoutItem>(items: T[], order: string[] = []): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) ordered.push(item);
    byId.delete(id);
  }
  return [...ordered, ...byId.values()];
}

export const WORK_FIELD_TYPES = [
  { id: 'text', label: 'Text' }, { id: 'longText', label: 'Long text' },
  { id: 'integer', label: 'Whole number' }, { id: 'decimal', label: 'Decimal number' },
  { id: 'date', label: 'Date' }, { id: 'amount', label: 'Amount and currency' },
  { id: 'list', label: 'List' }, { id: 'boolean', label: 'Yes / No' }, { id: 'file', label: 'File' }
] as const;
export type WorkFieldType = typeof WORK_FIELD_TYPES[number]['id'];
export type WorkFieldOption = { id: string; label: string; archived: boolean };
export type WorkField = {
  id: string; label: string; card: WorkFieldCard; type: WorkFieldType; multiple: boolean;
  required: boolean; showInList: boolean; archived: boolean; options: WorkFieldOption[];
};
export const WORK_CATALOGS = [
  { key: 'entities', reference: 'entityId', label: 'Entity', title: 'Organizational units' },
  { key: 'serviceTypes', reference: 'serviceTypeId', label: 'Service type', title: 'Service types' }
] as const;
export type WorkCatalog = typeof WORK_CATALOGS[number]['key'];
export type WorkFieldSettings = { version: number; fields: WorkField[]; projectSizeGrouping: boolean;
  fieldOrder?: WorkFieldOrder; hiddenFields?: string[]; columnVisibility?: Record<string, boolean> } & Record<WorkCatalog, WorkFieldOption[]>;
export type WorkSettingsChange = { field: WorkField } | { catalog: WorkCatalog; entry: WorkFieldOption } | { projectSizeGrouping: boolean } |
  { fieldOrder: { card: WorkFieldCard; order: string[]; hidden?: string[] } } |
  { layout: { fields: { key: string; field: WorkField }[]; orders: WorkFieldOrder; hidden: string[]; columns: Record<string, boolean> } };

export const PROJECT_SIZES = ['Small', 'Medium', 'Large'] as const;
export const REPORT_PAYMENT_STATUSES = [
  { id: 'not_invoiced', label: 'Not invoiced' }, { id: 'invoiced', label: 'Invoiced' },
  { id: 'partially_paid', label: 'Partially paid' }, { id: 'paid', label: 'Paid' }
] as const;
export type WorkReporting = {
  projectSize?: typeof PROJECT_SIZES[number] | '';
  backupId?: string; nextAction?: string; actionDue?: string;
  invoicedAmount?: number | null; paidAmount?: number | null;
  paymentStatus?: typeof REPORT_PAYMENT_STATUSES[number]['id'] | '';
};
export type WorkFieldFile = { id: string; name: string; size: number };
export type WorkFieldAmount = { amount: number; currency: string };
export type WorkFieldValue = string | number | boolean | string[] | WorkFieldFile | WorkFieldAmount | null;
export type WorkFieldValues = Record<string, WorkFieldValue>;
export type WorkFieldFiles = Record<string, File>;

export function isWorkFieldFile(value: WorkFieldValue | undefined): value is WorkFieldFile {
  return value != null && typeof value === 'object' && 'name' in value;
}

export function displayWorkField(field: WorkField, value: WorkFieldValue | undefined): string {
  if (value == null) return '—';
  if (field.type === 'list') {
    const ids = Array.isArray(value) ? value : [value];
    return ids.map((id) => field.options.find((item) => item.id === id)?.label).filter(Boolean).join(', ') || '—';
  }
  if (isWorkFieldFile(value)) return value.name;
  if (typeof value === 'object' && 'amount' in value) return `${value.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${value.currency}`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
