import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CatalogEntry, Custom, Field, FieldTarget, Group, Issue, Preview, ProjectTrackerService,
  RecordData, References, Task, TrackerData, TrackerDetail, TrackerRow
} from './project-tracker.service';
import { displayField, TrackerFieldInputsComponent } from './tracker-field-inputs.component';
import { errorText } from './project-tracker-settings.component';

type View = 'projects' | 'dashboard' | 'questions' | 'groups' | 'import';
interface ImportDecision { no: string; workId?: string; create?: boolean; }
interface Summary {
  label: string; total: number; active: number; leads: number; completed: number; onHold: number; cancelled: number; lost: number;
  overdue: number; attention: number; eur: number; activeEur: number; pipelineEur: number; missingRates: number; valueCount: number;
}

const newTask = () => ({ id: '', title: '', ownerId: '', due: '', next: false, custom: {} as Custom });
const newIssue = (): RecordData<Issue> => ({ id: 'new', version: 0, data: { workId: '', title: '', description: '', ownerId: '', closed: false } });
const newGroup = (): RecordData<Group> => ({ id: 'new', version: 0, data: { name: '', description: '', custom: {} } });
const dateNow = () => new Date().toISOString().slice(0, 10);

@Component({
  imports: [CommonModule, FormsModule, RouterLink, TrackerFieldInputsComponent],
  templateUrl: './project-tracker.component.html',
  styleUrl: './project-tracker.scss'
})
export class ProjectTrackerComponent implements OnInit {
  private readonly api = inject(ProjectTrackerService);
  private readonly route = inject(ActivatedRoute);
  refs?: References;
  rows: TrackerRow[] = [];
  issues: RecordData<Issue>[] = [];
  asOf = '';
  view: View = 'projects';
  views: { id: View; label: string }[] = [
    { id: 'projects', label: 'Projects' }, { id: 'dashboard', label: 'Dashboard' }, { id: 'questions', label: 'Open questions' },
    { id: 'groups', label: 'Project groups' }, { id: 'import', label: 'Excel import' }
  ];
  search = '';
  stage = '';
  unit = '';
  group = '';
  owner = '';
  service = '';
  check = '';
  customField = '';
  customSearch = '';
  includeArchived = false;
  remindersOnly = false;
  page = 1;
  pageSize = 50;
  statuses = [
    ['inquiry', 'Inquiry'], ['offer', 'Offer / awaiting confirmation'], ['to_start', 'To start'], ['in_progress', 'In progress'],
    ['on_hold', 'On hold'], ['completed_billable', 'Completed'], ['cancelled', 'Cancelled'], ['lost', 'Lost']
  ];
  error = '';
  notice = '';
  loading = false;
  busy = false;
  selected?: TrackerDetail;
  details: TrackerData = {};
  status = '';
  statusReason = '';
  deadline = '';
  task = newTask();
  allocations: { subWorkId: string; amount: number | null }[] = [];
  invoice = { number: '', issued: dateNow(), due: '', amount: null as number | null };
  settlement = { invoiceId: '', action: 'payment', amount: null as number | null, date: dateNow(), reference: '', reason: '', kind: 'credit' };
  taskChanges: Custom = {};
  groupChanges: Custom = {};
  opening = { invoiced: null as number | null, paid: null as number | null, due: '' };
  issue?: RecordData<Issue>;
  groupDraft?: RecordData<Group>;
  allIssues = false;
  importFile?: File;
  importSource = 'project-tracker-2026';
  importPreview?: Preview;
  previewSource = '';
  importDecisions: Record<string, string> = {};
  importWorkNumbers: Record<string, string> = {};
  importResults: Record<string, string> = {};
  importQuestions = true;
  readonly displayField = displayField;

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const [refs, portfolio, issues] = await Promise.all([
        firstValueFrom(this.api.references()), firstValueFrom(this.api.rows()), firstValueFrom(this.api.issues())
      ]);
      this.refs = refs;
      this.rows = portfolio.rows;
      this.asOf = portfolio.asOf;
      this.issues = issues;
      const requested = this.route.snapshot.queryParamMap.get('work');
      if (requested && !this.selected) await this.open(requested);
    } catch (error) { this.error = errorText(error); }
    finally { this.loading = false; }
  }

  selectView(view: View): void {
    this.view = view;
    this.selected = undefined;
    this.error = '';
    this.notice = '';
  }

  get users(): CatalogEntry[] { return this.refs?.users || []; }
  get units(): CatalogEntry[] { return this.refs?.settings.data.units || []; }
  get services(): CatalogEntry[] { return this.refs?.settings.data.services || []; }
  get groups(): RecordData<Group>[] { return this.refs?.groups || []; }
  get reminders(): TrackerRow[] {
    const actor = this.refs?.actor;
    return this.rows.filter((row) => actor && !row.archivedAt && (row.responsibleUserId === actor || row.backupId === actor) && row.reviewDue);
  }
  get checkTypes(): string[] { return [...new Set(this.rows.flatMap((row) => row.checks))].sort(); }

  fields(target: FieldTarget, location: string): Field[] {
    return this.refs?.settings.data.fields.filter((field) => !field.archived && field.target === target && field.locations.includes(location)) || [];
  }

  label(items: CatalogEntry[], id: string | null | undefined): string { return items.find((item) => item.id === id)?.name || ''; }
  groupLabel(id: string): string { return this.groups.find((item) => item.id === id)?.data.name || ''; }
  statusLabel(value: string): string { return this.statuses.find((entry) => entry[0] === value)?.[1] || value.replaceAll('_', ' '); }
  invoiceOutstanding(invoice: { cents: number; payments: { cents: number; voidedAt?: string }[]; adjustments: { cents: number; voidedAt?: string }[] }): number {
    return (invoice.cents - [...invoice.payments, ...invoice.adjustments].filter((entry) => !entry.voidedAt).reduce((sum, entry) => sum + entry.cents, 0)) / 100;
  }

  get filtered(): TrackerRow[] {
    const term = this.search.trim().toLowerCase();
    const field = this.fields('work', 'trackerList').find((item) => item.id === this.customField);
    const due = this.remindersOnly ? new Set(this.reminders.map((row) => row.id)) : null;
    return this.rows.filter((row) => (this.includeArchived || !row.archivedAt)
      && (!due || due.has(row.id))
      && (!this.stage || row.stage === this.stage) && (!this.unit || row.unitId === this.unit)
      && (!this.owner || (this.owner === 'unassigned' ? !row.responsibleUserId : row.responsibleUserId === this.owner))
      && (!this.group || row.groupId === this.group) && (!this.service || row.serviceId === this.service)
      && (!this.check || (this.check === 'attention' ? row.checks.length : row.checks.includes(this.check)))
      && (!field || !this.customSearch || displayField(field, row.custom[field.id], this.users).toLowerCase().includes(this.customSearch.toLowerCase()))
      && (!term || [row.name, row.customer, row.sourceClient, row.workNumber, row.po, this.groupLabel(row.groupId)]
        .some((value) => value?.toLowerCase().includes(term))))
      .sort((a, b) => Number(b.overdue || b.actionOverdue || b.payment.overdue) - Number(a.overdue || a.actionOverdue || a.payment.overdue)
        || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.workNumber.localeCompare(b.workNumber));
  }

  get operational(): TrackerRow[] { return this.rows.filter((row) => !row.archivedAt); }
  get metrics() { return this.stats(this.operational, 'All'); }
  get currencyTotals() {
    return [...new Set(this.rows.map((row) => row.currency))].sort().map((currency) => {
      const rows = this.rows.filter((row) => row.currency === currency);
      return { currency, contract: rows.filter((row) => !row.archivedAt && ['Active', 'Completed', 'On hold'].includes(row.stage)).reduce((sum, row) => sum + (row.value || 0), 0),
        invoiced: rows.reduce((sum, row) => sum + row.payment.invoiced, 0), paid: rows.reduce((sum, row) => sum + row.payment.paid, 0),
        receivable: rows.reduce((sum, row) => sum + (row.payment.receivable ?? 0), 0), unbilled: rows.reduce((sum, row) => sum + (row.payment.unbilled ?? 0), 0),
        unresolved: rows.filter((row) => row.payment.status === 'Needs reconciliation').length };
    });
  }
  stats(rows: TrackerRow[], label: string): Summary {
    const stage = (value: string) => rows.filter((row) => row.stage === value).length;
    return { label, total: rows.length, active: stage('Active'), leads: stage('Lead'), completed: stage('Completed'), onHold: stage('On hold'),
      cancelled: stage('Cancelled'), lost: stage('Lost'), overdue: rows.filter((row) => row.overdue).length,
      attention: rows.filter((row) => row.checks.length).length, eur: rows.reduce((sum, row) => sum + (row.eur ?? 0), 0),
      activeEur: rows.filter((row) => row.stage === 'Active').reduce((sum, row) => sum + (row.eur ?? 0), 0),
      pipelineEur: rows.filter((row) => row.stage === 'Lead').reduce((sum, row) => sum + (row.eur ?? 0), 0),
      valueCount: rows.filter((row) => row.eur != null).length,
      missingRates: rows.filter((row) => row.value != null && row.eur == null).length };
  }
  deadlineCount(state: string): number { return this.operational.filter((row) => row.deadlineState === state).length; }
  issueCount(issue: string): number { return this.operational.filter((row) => row.checks.includes(issue)).length; }
  get ownerStats() { return [...this.users, { id: '', name: 'Unassigned' }].map((item) => this.stats(this.operational.filter((row) => (row.responsibleUserId || '') === item.id), item.name)); }
  get unitStats() { return [...this.units, { id: '', name: 'Unassigned' }].map((item) => this.stats(this.operational.filter((row) => row.unitId === item.id), item.name)); }
  get serviceStats() {
    return [...this.services, { id: '', name: 'Unspecified' }].map((item) => {
      const rows = this.operational.filter((row) => row.serviceId === item.id);
      const valueRows = rows.filter((row) => ['Active', 'Completed'].includes(row.stage));
      return { ...this.stats(rows, item.name), eur: valueRows.reduce((sum, row) => sum + (row.eur ?? 0), 0) };
    });
  }
  get sizeStats() { return ['Small', 'Medium', 'Large', 'Unknown'].map((size) => this.stats(this.operational.filter((row) => ['Active', 'Completed'].includes(row.stage) && (row.size || 'Unknown') === size), size)); }

  drill(filter: { stage?: string; check?: string; owner?: string; unit?: string; service?: string }): void {
    this.selectView('projects');
    this.remindersOnly = false;
    this.search = ''; this.group = ''; this.customField = ''; this.customSearch = '';
    this.stage = filter.stage || ''; this.check = filter.check || ''; this.owner = filter.owner || '';
    this.unit = filter.unit || ''; this.service = filter.service || ''; this.page = 1;
  }

  async open(id: string): Promise<void> {
    this.error = '';
    try {
      const result = await firstValueFrom(this.api.detail(id));
      this.selected = result;
      this.details = structuredClone(result.data);
      this.details.custom = {};
      this.status = result.work.status;
      this.statusReason = result.work.statusReason || '';
      this.deadline = result.work.deadline || '';
      this.task = newTask();
      this.taskChanges = {};
      this.allocations = [];
      this.invoice = { number: '', issued: this.asOf || dateNow(), due: '', amount: null };
      this.settlement = { invoiceId: '', action: 'payment', amount: null, date: this.asOf || dateNow(), reference: '', reason: '', kind: 'credit' };
      const balance = result.data.opening;
      this.opening = { invoiced: balance?.invoicedCents == null ? null : balance.invoicedCents / 100,
        paid: balance?.paidCents == null ? null : balance.paidCents / 100, due: balance?.due || '' };
    } catch (error) { this.error = errorText(error); }
  }

  async run(action: () => Promise<unknown>, message: string, after?: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = ''; this.notice = '';
    try {
      await action();
      if (after) await after();
      this.notice = message;
    } catch (error) { this.error = errorText(error); }
    finally { this.busy = false; }
  }
  async refreshRows(): Promise<void> {
    const result = await firstValueFrom(this.api.rows());
    this.rows = result.rows;
    this.asOf = result.asOf;
  }
  change(action: string, value: object = {}): void {
    const record = this.selected;
    if (!record) return;
    void this.run(() => firstValueFrom(this.api.update(record.id, record.version, action, value)), 'Work updated.',
      async () => { await this.open(record.id); await this.refreshRows(); });
  }
  saveCore(): void {
    const record = this.selected;
    if (!record) return;
    const value: { deadline: string | null; status?: string; statusReason?: string; expectedUpdatedAt?: string } = { deadline: this.deadline || null, expectedUpdatedAt: record.work.updatedAt };
    if (this.status !== record.work.status) value.status = this.status;
    if (['lost', 'cancelled'].includes(this.status)) value.statusReason = this.statusReason;
    void this.run(() => firstValueFrom(this.api.core(record.id, value)), 'Work updated.',
      async () => { await this.open(record.id); await this.refreshRows(); });
  }
  editTask(task: Task): void {
    this.task = { ...task, due: task.due || '', next: this.selected?.data.nextTaskId === task.id, custom: { ...task.custom } };
    this.taskChanges = {};
  }
  saveTask(): void { this.change('task', { ...this.task, custom: this.taskChanges }); }
  saveInvoice(): void { this.change('invoice', { ...this.invoice, allocations: this.allocations }); }
  get eurPayments() {
    return this.rows.reduce((summary, row) => ({
      receivable: summary.receivable + (row.fxRate && row.payment.receivable != null ? row.payment.receivable / row.fxRate : 0),
      unbilled: summary.unbilled + (row.fxRate && row.payment.unbilled != null ? row.payment.unbilled / row.fxRate : 0)
    }), { receivable: 0, unbilled: 0 });
  }
  reverse(invoiceId: string, paymentId?: string, adjustmentId?: string): void {
    const reason = window.prompt('Reason for reversing this entry');
    if (reason?.trim()) this.change('void', { invoiceId, paymentId, adjustmentId, reason });
  }
  saveIssue(): void {
    const draft = this.issue;
    if (!draft) return;
    void this.run(() => firstValueFrom(this.api.issue(draft.id, draft.version, draft.data)), 'Question saved.', async () => {
      this.issues = await firstValueFrom(this.api.issues()); this.issue = undefined;
    });
  }
  editIssue(issue?: RecordData<Issue>, workId = ''): void {
    this.issue = issue ? structuredClone(issue) : newIssue();
    if (!issue) this.issue.data.workId = workId;
    this.selectView('questions');
  }
  saveGroup(): void {
    const draft = this.groupDraft;
    if (!draft) return;
    void this.run(() => firstValueFrom(this.api.group(draft.id, draft.version, { ...draft.data, custom: this.groupChanges })), 'Group saved.', async () => {
      this.refs = await firstValueFrom(this.api.references()); this.groupDraft = undefined;
    });
  }
  editGroup(group?: RecordData<Group>): void {
    this.groupDraft = group ? structuredClone(group) : newGroup();
    this.groupDraft.data.custom ||= {};
    this.groupChanges = {};
  }
  setFile(event: Event): void {
    this.importFile = (event.target as HTMLInputElement).files?.[0];
    this.importPreview = undefined; this.importResults = {};
  }
  preview(): void {
    const file = this.importFile;
    if (!file) return;
    const source = this.importSource;
    void this.run(async () => {
      this.importPreview = await firstValueFrom(this.api.preview(file, source));
      this.previewSource = source;
      this.importDecisions = {}; this.importWorkNumbers = {}; this.importResults = {};
    }, 'Preview ready. Approve each row to import.');
  }
  approveNewRows(): void {
    for (const row of this.importPreview?.rows || []) if (!row.importedId && !row.matches.length) this.importDecisions[row.no] = 'create';
  }
  get selectedImports(): number { return Object.values(this.importDecisions).filter(Boolean).length; }
  get hasMissingImport(): boolean { return Boolean(this.importPreview?.rows.some((row) => !row.importedId && !this.importDecisions[row.no])); }

  async importRows(): Promise<void> {
    const file = this.importFile;
    const preview = this.importPreview;
    if (!file || !preview || this.previewSource !== this.importSource) return;
    const decisions: ImportDecision[] = [];
    for (const [no, decision] of Object.entries(this.importDecisions)) {
      if (decision === 'create') decisions.push({ no, create: true });
      else if (decision === 'other') {
        const entered = this.importWorkNumbers[no]?.trim().toLowerCase();
        const match = this.rows.find((row) => !row.archivedAt && row.workNumber.toLowerCase() === entered);
        if (!match) { this.error = 'Enter an existing work number for source row ' + no; return; }
        decisions.push({ no, workId: match.id });
      } else if (decision) decisions.push({ no, workId: decision });
    }
    const shouldImportQuestions = this.importQuestions && !this.hasMissingImport;
    await this.run(async () => {
      const last = Math.max(1, Math.ceil(decisions.length / 50));
      let failures = false;
      for (let index = 0; index < last; index++) {
        const result = await firstValueFrom(this.api.apply(file, this.previewSource, preview.hash,
          decisions.slice(index * 50, index * 50 + 50), shouldImportQuestions && index === last - 1 && !failures));
        for (const row of result.results) {
          this.importResults[row.no] = row.error || 'Imported';
          if (row.error) failures = true;
          else {
            delete this.importDecisions[row.no];
            const source = preview.rows.find((item) => item.no === row.no);
            if (source) source.importedId = row.workId;
          }
        }
      }
      if (failures) this.error = 'Some rows need attention. See the result next to each row.';
      this.refs = await firstValueFrom(this.api.references());
      this.issues = await firstValueFrom(this.api.issues());
      await this.refreshRows();
    }, 'Import processed.');
  }

  download(): void {
    void this.run(async () => {
      const blob = await firstValueFrom(this.api.export());
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'project-tracker.xlsx';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'Export downloaded.');
  }
}
