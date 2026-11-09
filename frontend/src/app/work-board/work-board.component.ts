import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../services/auth.service';
import { ClientPayload, SubWorkItem, SubWorkPayload, TenantUserOption, WorkBoardClient, WorkBoardService, WorkDocument, WorkItem, WorkPayload, WorkStatus } from '../services/work-board.service';
import { WorkFieldValuesComponent } from './work-field-values.component';
import { displayWorkField, isWorkFieldFile, PROJECT_SIZES, REPORT_PAYMENT_STATUSES, WORK_CATALOGS, WorkCatalog, WorkField, WorkFieldCard, WorkFieldFiles, WorkFieldOption, WorkFieldValues, WorkReporting } from './work-fields';

type WorkForm = {
  name: string; clientId: string; responsibleUserId: string; status: WorkStatus; deadline: Date | null; description: string;
  entityId: string; serviceTypeId: string;
  currency: string; totalAmount: number; costAmount: number; subcontractor: string; paymentDeadlineDays: number;
  offerDate: Date | null; completionDate: Date | null; invoiceDate: Date | null; invoicePaymentDeadline: Date | null; invoiceNumber: string;
  contractSigned: boolean; performanceCertificate: boolean;
};
type SubWorkForm = {
  name: string; responsibleUserId: string; status: WorkStatus; deadline: Date | null; description: string; plannedHours: number;
  amount: number; percentage: number; performanceCertificateRequired: boolean; performanceCertificateSigned: boolean;
  invoiceNumber: string; invoiceDate: Date | null; invoicePaymentDeadline: Date | null; paidAmount: number; paidAt: Date | null;
};

@Component({
  selector: 'app-work-board',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule, MatNativeDateModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, MatSnackBarModule, WorkFieldValuesComponent],
  templateUrl: './work-board.component.html',
  styleUrl: './work-board.component.scss'
})
export class WorkBoardComponent implements OnInit {
  works: WorkItem[] = [];
  clients: WorkBoardClient[] = [];
  tenantUsers: TenantUserOption[] = [];
  selectedWork: WorkItem | null = null;
  customFields: WorkField[] = [];
  reportingEnabled = false;
  projectSizeGrouping = false;
  reportForm: WorkReporting = {};
  readonly projectSizes = PROJECT_SIZES;
  readonly reportPaymentStatuses = REPORT_PAYMENT_STATUSES;
  readonly catalogDefinitions = WORK_CATALOGS;
  catalogs: Record<WorkCatalog, WorkFieldOption[]> = { entities: [], serviceTypes: [] };
  fieldChanges: WorkFieldValues = {};
  fieldFiles: WorkFieldFiles = {};
  expandedWorkIds = new Set<string>();
  detailView = false;
  loading = true;
  saving = false;
  search = '';
  statusFilter: WorkStatus | 'active' | 'all' | 'deleted' = 'active';
  page = 1;
  pageSize = 25;
  totalWorks = 0;
  totalPages = 1;
  defaultCurrency = 'HUF';
  readonly workCurrencies = ['HUF', 'EUR', 'USD', 'AED'];
  documents: WorkDocument[] = [];
  documentsLoading = false;
  documentUploading = false;
  documentCategory = 'offer';
  documentCustomName = '';
  selectedDocumentFile: File | null = null;
  readonly documentCategories = [
    { value: 'offer', label: 'Ajánlat' }, { value: 'contract_draft', label: 'Szerződéstervezet' },
    { value: 'contract', label: 'Szerződés' }, { value: 'order', label: 'Megrendelés' },
    { value: 'performance_certificate', label: 'Teljesítésigazolás' }, { value: 'other', label: 'Egyéb' }
  ];
  showWorkForm = false;
  showSubWorkForm = false;
  showClientPanel = false;
  clientLookupFound: WorkBoardClient | null = null;
  clientLookupLinked = false;
  clientForm: ClientPayload = this.emptyClientForm();
  editingWork = false;
  editingSubWorkId: string | null = null;
  workForm: WorkForm = this.emptyWorkForm();
  subWorkForm: SubWorkForm = this.emptySubWorkForm();
  readonly statuses: { value: WorkStatus; label: string }[] = [
    { value: 'inquiry', label: 'Inquiry' }, { value: 'offer', label: 'Offer' }, { value: 'to_start', label: 'To start' },
    { value: 'in_progress', label: 'In progress' }, { value: 'on_hold', label: 'On hold' },
    { value: 'completed_billable', label: 'Completed, billable' }, { value: 'invoiced', label: 'Invoiced' },
    { value: 'paid', label: 'Paid' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'lost', label: 'Lost' }
  ];
  readonly terminalStatuses = new Set<WorkStatus>(['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled', 'lost']);
  private readonly statusRank: Record<WorkStatus, number> = {
    inquiry: 0, offer: 1, to_start: 2, in_progress: 2, on_hold: 2, completed_billable: 3,
    invoiced: 4, paid: 5, closed: 6, cancelled: 6, lost: 1
  };
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadRequestId = 0;
  private referencesLoaded = false;

  constructor(private board: WorkBoardService, private snackBar: MatSnackBar, public auth: AuthService, private route: ActivatedRoute) {}
  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('work');
    void this.load().then(async () => {
      if (!id || this.showWorkForm || this.detailView) return;
      try {
        const work = this.works.find((item) => item.id === id) || await firstValueFrom(this.board.getWork(id));
        if (!this.showWorkForm && !this.detailView) this.selectWork(work);
      } catch (error) { this.error(error, 'The work could not be opened.'); }
    });
  }

  get filteredWorks(): WorkItem[] { return this.works; }
  get pageStart(): number { return this.totalWorks ? (this.page - 1) * this.pageSize + 1 : 0; }
  get pageEnd(): number { return Math.min(this.page * this.pageSize, this.totalWorks); }

  async load(selectId?: string): Promise<void> {
    const requestId = ++this.loadRequestId;
    this.loading = true;
    try {
      const [workPage, clients, users, settings] = await Promise.all([
        firstValueFrom(this.board.listWorks({ page: this.page, limit: this.pageSize, search: this.search.trim(), status: this.statusFilter })),
        this.referencesLoaded ? Promise.resolve(this.clients) : firstValueFrom(this.board.listClients()),
        this.referencesLoaded ? Promise.resolve(this.tenantUsers) : firstValueFrom(this.board.listTenantUsers()),
        this.referencesLoaded || !this.auth.isWorkFieldTenant() ? Promise.resolve(null) : firstValueFrom(this.board.fieldSettings())
      ]);
      if (requestId !== this.loadRequestId) return;
      this.works = workPage.works;
      this.clients = clients;
      this.tenantUsers = users;
      if (settings) {
        this.reportingEnabled = true;
        this.projectSizeGrouping = settings.projectSizeGrouping === true;
        this.customFields = settings.fields.filter((field) => !field.archived);
        this.catalogs = { entities: settings.entities ?? [], serviceTypes: settings.serviceTypes ?? [] };
      }
      this.referencesLoaded = true;
      this.page = workPage.pagination.page;
      this.totalWorks = workPage.pagination.total;
      this.totalPages = workPage.pagination.pages;
      this.defaultCurrency = workPage.summary.activeValue?.currency || 'HUF';
      const id = selectId || this.selectedWork?.id || this.works[0]?.id;
      this.selectedWork = this.works.find((work) => work.id === id) || null;
    } catch (error: any) { if (requestId === this.loadRequestId) this.error(error, 'Works could not be loaded.'); }
    finally { if (requestId === this.loadRequestId) this.loading = false; }
  }
  filtersChanged(debounce = false): void {
    this.page = 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (debounce) this.searchTimer = setTimeout(() => void this.load(), 300);
    else void this.load();
  }
  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) return;
    this.page = nextPage;
    this.expandedWorkIds = new Set<string>();
    void this.load();
  }
  pageSizeChanged(): void { this.page = 1; this.expandedWorkIds = new Set<string>(); void this.load(); }
  selectWork(work: WorkItem): void { this.selectedWork = work; this.cancelForms(); this.detailView = true; void this.loadDocuments(work.id); }
  toggleWorkExpansion(work: WorkItem, event?: Event): void {
    event?.stopPropagation();
    const next = new Set(this.expandedWorkIds);
    if (next.has(work.id)) next.delete(work.id);
    else next.add(work.id);
    this.expandedWorkIds = next;
  }
  isWorkExpanded(work: WorkItem): boolean { return this.expandedWorkIds.has(work.id); }
  trackWork(_: number, work: WorkItem): string { return work.id; }
  trackSubWork(_: number, subWork: SubWorkItem): string { return subWork.id; }
  backToTable(): void { this.cancelForms(); this.detailView = false; this.documents = []; }
  startCreateWork(): void {
    this.workForm = this.emptyWorkForm(); this.fieldChanges = {}; this.fieldFiles = {};
    this.reportForm = {};
    this.editingWork = false; this.detailView = false; this.showClientPanel = false; this.showWorkForm = true;
  }
  startEditWork(): void {
    if (!this.selectedWork) return;
    const w = this.selectedWork;
    this.workForm = {
      name: w.name, clientId: w.clientId || '', responsibleUserId: w.responsibleUserId || '', status: w.status, deadline: this.dateValue(w.deadline), description: w.description,
      entityId: w.entityId || '', serviceTypeId: w.serviceTypeId || '',
      currency: w.currency, totalAmount: w.totalAmount, costAmount: w.costAmount, subcontractor: w.subcontractor,
      paymentDeadlineDays: w.paymentDeadlineDays, offerDate: this.dateValue(w.offerDate), completionDate: this.dateValue(w.completionDate),
      invoiceDate: this.dateValue(w.invoiceDate), invoicePaymentDeadline: this.dateValue(w.invoicePaymentDeadline), invoiceNumber: w.invoiceNumber,
      contractSigned: w.contractSigned, performanceCertificate: w.performanceCertificate
    };
    this.fieldChanges = {};
    this.fieldFiles = {};
    this.reportForm = { ...w.reporting };
    this.editingWork = true; this.showWorkForm = true;
  }
  async saveWork(): Promise<void> {
    if (!this.workForm.name.trim()) return this.notice('Work name is required.');
    const active = this.customFields.filter((field) => this.fieldRelevant(field, this.workForm.status));
    const missing = active.find((field) => {
      if (!field.required || this.fieldFiles[field.id]) return false;
      const value = Object.hasOwn(this.fieldChanges, field.id) ? this.fieldChanges[field.id] : this.editorValues[field.id];
      return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);
    });
    if (missing) return this.notice(`${missing.label} is required.`);
    if (this.saving) return;
    this.saving = true;
    try {
      const ids = new Set(active.map((field) => field.id));
      const files = Object.fromEntries(Object.entries(this.fieldFiles).filter(([id]) => ids.has(id)));
      const reporting = { ...this.reportForm };
      if (!this.projectSizeGrouping) delete reporting.projectSize;
      if (reporting.nextAction !== undefined) reporting.nextAction = reporting.nextAction.trim();
      const payload = { ...this.workForm, name: this.workForm.name.trim(),
        reporting: this.reportingEnabled ? reporting : undefined,
        customFields: Object.fromEntries(Object.entries(this.fieldChanges).filter(([id]) => ids.has(id))),
        fieldRevision: this.editingWork ? this.selectedWork?.fieldRevision : undefined } as WorkPayload;
      const saved = this.editingWork && this.selectedWork
        ? await firstValueFrom(this.board.updateWork(this.selectedWork.id, payload, files))
        : await firstValueFrom(this.board.createWork(payload, files));
      this.showWorkForm = false; await this.load(saved.id); this.selectedWork = saved; this.detailView = true; this.notice('Work saved.');
    } catch (error: any) { this.error(error, 'Work could not be saved.'); }
    finally { this.saving = false; }
  }
  async archiveWork(): Promise<void> {
    if (!this.selectedWork || !confirm(`Move ${this.selectedWork.workNumber} · ${this.selectedWork.name} to deleted works?\n\nIt can be restored later.`)) return;
    try { await firstValueFrom(this.board.archiveWork(this.selectedWork.id)); this.selectedWork = null; this.detailView = false; await this.load(); this.notice('Work moved to deleted works.'); }
    catch (error: any) { this.error(error, 'Work could not be deleted.'); }
  }
  async restoreWork(): Promise<void> {
    if (!this.selectedWork) return;
    try {
      const restored = await firstValueFrom(this.board.restoreWork(this.selectedWork.id));
      this.selectedWork = restored; this.statusFilter = 'all'; this.page = 1; await this.load(restored.id); this.selectedWork = restored; this.notice('Work restored.');
    } catch (error: any) { this.error(error, 'Work could not be restored.'); }
  }
  startCreateSubWork(): void { if (!this.selectedWork) return; this.subWorkForm = this.emptySubWorkForm(); this.editingSubWorkId = null; this.showSubWorkForm = true; }
  startEditSubWork(sub: SubWorkItem): void {
    this.subWorkForm = {
      name: sub.name, responsibleUserId: sub.responsibleUserId || '', status: sub.status, deadline: this.dateValue(sub.deadline), description: sub.description,
      plannedHours: sub.plannedHours, amount: sub.amount, percentage: sub.percentage,
      performanceCertificateRequired: sub.performanceCertificateRequired, performanceCertificateSigned: sub.performanceCertificateSigned,
      invoiceNumber: sub.invoiceNumber, invoiceDate: this.dateValue(sub.invoiceDate), invoicePaymentDeadline: this.dateValue(sub.invoicePaymentDeadline),
      paidAmount: sub.paidAmount, paidAt: this.dateValue(sub.paidAt)
    };
    this.editingSubWorkId = sub.id; this.showSubWorkForm = true;
  }
  percentageChanged(): void {
    if (!this.selectedWork) return;
    this.subWorkForm.amount = Math.round((this.selectedWork.totalAmount * Number(this.subWorkForm.percentage || 0)) / 100 * 100) / 100;
  }
  amountChanged(): void {
    if (!this.selectedWork?.totalAmount) { this.subWorkForm.percentage = 0; return; }
    this.subWorkForm.percentage = Math.round((Number(this.subWorkForm.amount || 0) / this.selectedWork.totalAmount) * 10000) / 100;
  }
  async saveSubWork(): Promise<void> {
    if (!this.selectedWork || !this.subWorkForm.name.trim()) return this.notice('Sub-work name is required.');
    this.saving = true;
    try {
      const { percentage, ...values } = this.subWorkForm;
      const payload = { ...values, name: values.name.trim(), currency: this.selectedWork.currency } as SubWorkPayload;
      if (this.editingSubWorkId) await firstValueFrom(this.board.updateSubWork(this.editingSubWorkId, payload));
      else await firstValueFrom(this.board.createSubWork(this.selectedWork.id, payload));
      const id = this.selectedWork.id; this.showSubWorkForm = false; await this.load(id); this.notice('Sub-work saved.');
    } catch (error: any) { this.error(error, 'Sub-work could not be saved.'); }
    finally { this.saving = false; }
  }
  async archiveSubWork(sub: SubWorkItem): Promise<void> {
    if (!this.selectedWork || !confirm(`Archive ${sub.subWorkNumber} · ${sub.name}?`)) return;
    try { await firstValueFrom(this.board.archiveSubWork(sub.id)); await this.load(this.selectedWork.id); }
    catch (error: any) { this.error(error, 'Sub-work could not be archived.'); }
  }
  async loadDocuments(workId = this.selectedWork?.id): Promise<void> {
    if (!workId) return;
    this.documentsLoading = true;
    try { this.documents = await firstValueFrom(this.board.listDocuments(workId)); }
    catch (error: any) { this.error(error, 'Documents could not be loaded.'); }
    finally { this.documentsLoading = false; }
  }
  chooseDocument(input: HTMLInputElement): void {
    this.selectedDocumentFile = input.files?.[0] || null;
  }
  async uploadDocument(input: HTMLInputElement): Promise<void> {
    if (!this.selectedWork || !this.selectedDocumentFile) return this.notice('Select a file to upload.');
    if (this.documentCategory === 'other' && !this.documentCustomName.trim()) return this.notice('Enter a custom document name.');
    this.documentUploading = true;
    try {
      await firstValueFrom(this.board.uploadDocument(this.selectedWork.id, this.selectedDocumentFile, this.documentCategory, this.documentCustomName.trim()));
      this.selectedDocumentFile = null; this.documentCustomName = ''; input.value = '';
      await this.loadDocuments(); this.notice('Document uploaded.');
    } catch (error: any) { this.error(error, 'Document could not be uploaded.'); }
    finally { this.documentUploading = false; }
  }
  async downloadDocument(document: WorkDocument): Promise<void> {
    try {
      const response = await firstValueFrom(this.board.downloadDocument(document.id));
      if (response.body) this.saveBlob(response.body, document.fileName);
    } catch (error: any) { this.error(error, 'Document could not be downloaded.'); }
  }
  async downloadField(work: WorkItem | null, field: WorkField): Promise<void> {
    const file = work?.customFields?.[field.id];
    if (!work || !isWorkFieldFile(file)) return;
    try {
      const blob = await firstValueFrom(this.board.downloadCustomField(work.id, field.id, Boolean(work.archivedAt)));
      this.saveBlob(blob, file.name);
    } catch (error: any) { this.error(error, 'File could not be downloaded.'); }
  }
  private saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async deleteDocument(document: WorkDocument): Promise<void> {
    if (!confirm(`Delete ${document.displayName} · ${document.fileName}?`)) return;
    try { await firstValueFrom(this.board.deleteDocument(document.id)); await this.loadDocuments(); this.notice('Document deleted.'); }
    catch (error: any) { this.error(error, 'Document could not be deleted.'); }
  }
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  documentIcon(document: WorkDocument): string {
    if (document.contentType === 'application/pdf') return 'picture_as_pdf';
    if (document.contentType.startsWith('image/')) return 'image';
    if (/word|document/.test(document.contentType)) return 'description';
    if (/excel|spreadsheet/.test(document.contentType)) return 'table';
    return 'draft';
  }
  cancelForms(): void { this.showWorkForm = false; this.showSubWorkForm = false; this.editingSubWorkId = null; }
  cancelWorkEditor(): void { this.showWorkForm = false; this.detailView = Boolean(this.editingWork && this.selectedWork); }
  openClientPanel(): void { this.showClientPanel = !this.showClientPanel; this.clientForm = this.emptyClientForm(); this.clientLookupFound = null; }
  async lookupClient(): Promise<void> {
    if (!this.clientForm.taxNumber.trim()) return this.notice('Tax number is required.');
    try {
      const result = await firstValueFrom(this.board.lookupClient(this.clientForm.taxNumber));
      this.clientLookupFound = result.client; this.clientLookupLinked = result.linked;
      if (result.client) this.clientForm = { ...result.client };
      else this.notice('No existing company found. Enter the company details to create it.');
    } catch (error: any) { this.error(error, 'Client lookup failed.'); }
  }
  async saveClient(): Promise<void> {
    if (!this.clientForm.taxNumber.trim() || !this.clientForm.name.trim()) return this.notice('Tax number and company name are required.');
    this.saving = true;
    try {
      const result = await firstValueFrom(this.board.createOrLinkClient(this.clientForm));
      this.clients = await firstValueFrom(this.board.listClients());
      this.workForm.clientId = result.client.id;
      this.notice(result.matchedExisting ? 'Existing company linked to this tenant.' : 'Client created.');
      this.showClientPanel = false;
    } catch (error: any) { this.error(error, 'Client could not be saved.'); }
    finally { this.saving = false; }
  }
  statusLabel(status: WorkStatus): string { return this.statuses.find((item) => item.value === status)?.label || status; }
  backupLabel(id?: string): string { return this.tenantUsers.find((user) => user.id === id)?.fullName || '—'; }
  reportPaymentLabel(status?: string): string { return this.reportPaymentStatuses.find((item) => item.id === status)?.label || '—'; }
  get editorValues(): WorkFieldValues { return (this.editingWork && this.selectedWork?.customFields) || {}; }
  get visibleCatalogs() { return this.catalogDefinitions.filter((catalog) => this.hasCatalogOptions(catalog.key)); }
  hasCatalogOptions(catalog: WorkCatalog): boolean { return this.catalogs[catalog].some((entry) => !entry.archived); }
  catalogOptions(catalog: WorkCatalog, current: string): WorkFieldOption[] {
    return this.catalogs[catalog].filter((entry) => !entry.archived || entry.id === current);
  }
  catalogLabel(catalog: WorkCatalog, id?: string | null): string {
    return this.catalogs[catalog].find((entry) => entry.id === id)?.label || '—';
  }
  get fieldColumns(): WorkField[] { return this.customFields.filter((field) => field.showInList); }
  cardFields(card: WorkFieldCard): WorkField[] { return this.customFields.filter((field) => field.card === card); }
  listField(work: WorkItem, field: WorkField): string {
    return this.fieldRelevant(field, work.status) ? displayWorkField(field, work.customFields?.[field.id]) : '—';
  }
  private fieldRelevant(field: WorkField, status: WorkStatus): boolean {
    const card = field.card;
    return card === 'basic' || card === 'description' || card === 'documents' || this.showFrom(card, status);
  }
  showFrom(stage: 'offer' | 'execution' | 'completion' | 'invoice' | 'payment', status: WorkStatus = this.workForm.status): boolean {
    const required = { offer: 1, execution: 2, completion: 3, invoice: 4, payment: 5 }[stage];
    return this.statusRank[status] >= required;
  }
  hasText(value: unknown): boolean { return String(value || '').trim().length > 0; }
  hasValue(value: unknown): boolean { return value !== null && value !== undefined && value !== '' && Number(value) !== 0; }
  formatMoney(value: number, currency = 'HUF'): string { return new Intl.NumberFormat('hu-HU', { style: 'currency', currency, maximumFractionDigits: currency === 'HUF' ? 0 : 2 }).format(value || 0); }
  isOverdue(value: string | null): boolean { return Boolean(value && new Date(value).getTime() < new Date().setHours(0, 0, 0, 0)); }
  private dateValue(value: string | null): Date | null { return value ? new Date(value) : null; }
  private notice(message: string): void { this.snackBar.open(message, 'OK', { duration: 3000 }); }
  private error(error: any, fallback: string): void { this.snackBar.open(error?.error?.error || fallback, 'OK', { duration: 4500 }); }
  private emptyWorkForm(): WorkForm { return { name: '', clientId: '', entityId: '', serviceTypeId: '', responsibleUserId: '', status: 'inquiry', deadline: null, description: '', currency: this.defaultCurrency, totalAmount: 0, costAmount: 0, subcontractor: '', paymentDeadlineDays: 30, offerDate: null, completionDate: null, invoiceDate: null, invoicePaymentDeadline: null, invoiceNumber: '', contractSigned: false, performanceCertificate: false }; }
  private emptySubWorkForm(): SubWorkForm { return { name: '', responsibleUserId: '', status: 'inquiry', deadline: null, description: '', plannedHours: 0, amount: 0, percentage: 0, performanceCertificateRequired: false, performanceCertificateSigned: false, invoiceNumber: '', invoiceDate: null, invoicePaymentDeadline: null, paidAmount: 0, paidAt: null }; }
  private emptyClientForm(): ClientPayload { return { taxNumber: '', name: '', country: 'HU', postalCode: '', city: '', address: '', email: '', phone: '' }; }
}
