import { WorkNextActionsComponent } from './work-next-actions.component';
import { CommonModule, formatDate, formatNumber } from '@angular/common';
import { Component, DestroyRef, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { AuthService } from '../services/auth.service';
import { ClientPayload, FinanceWork, FinanceWorkChanges, FinanceWorkStatus, SubWorkItem, SubWorkPayload, TenantUserOption, WorkBoardClient, WorkBoardService, WorkDocument, WorkItem, WorkPayload, WorkStatus, WorkbookTransferTarget } from '../services/work-board.service';
import { WorkFieldValuesComponent } from './work-field-values.component';
import { WorkLayoutListComponent } from './work-layout-list.component';
import { WorkTransferDialogComponent } from './work-transfer-dialog.component';
import { WorkFinancialEntriesComponent } from './work-financial-entries.component';
import { WorkRateInfoComponent } from './work-rate-info.component';
import { cardLayout, orderLayout, LayoutItem, WorkFieldOrder, displayWorkField, isWorkFieldFile, PROJECT_SIZES, REPORT_PAYMENT_STATUSES, WORK_CATALOGS, WorkCatalog, WorkCatalogEntry, WorkField, WorkFieldCard, WorkFieldFiles, WorkFieldValues, WorkReporting, workCatalogLabel } from './work-fields';

const billingCalendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' });
const billingDateFields = ['completionDate', 'invoiceDate', 'invoicePaymentDeadline', 'paidAt'] as const;

type WorkForm = {
  name: string; clientId: string; responsibleUserId: string; status: WorkStatus; deadline: Date | null; description: string;
  entityId: string; serviceTypeId: string;
  currency: string; totalAmount: number; costAmount: number; subcontractor: string; paymentDeadlineDays: number;
  offerDate: Date | null; completionDate: Date | null; invoiceDate: Date | null; invoicePaymentDeadline: Date | null; invoiceNumber: string;
  contractSigned: boolean; performanceCertificate: boolean; paidAt: Date | null;
};
type SubWorkForm = {
  name: string; responsibleUserId: string; status: WorkStatus; deadline: Date | null; description: string; plannedHours: number;
  amount: number; percentage: number; performanceCertificateRequired: boolean; performanceCertificateSigned: boolean;
  invoiceNumber: string; invoiceDate: Date | null; invoicePaymentDeadline: Date | null; paidAmount: number; paidAt: Date | null;
};

@Component({
  selector: 'app-work-board',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule, MatNativeDateModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, MatSnackBarModule, MatSortModule, WorkFieldValuesComponent, WorkLayoutListComponent, WorkFinancialEntriesComponent, WorkRateInfoComponent, WorkNextActionsComponent],
  templateUrl: './work-board.component.html',
  styleUrl: './work-board.component.scss'
})
export class WorkBoardComponent implements OnInit, OnDestroy {
  @Input() financeTenantId?: string;
  financeTenantName = '';
  financeWorks: FinanceWork[] = [];
  financeWork: FinanceWork | null = null;
  financeForm: (Required<FinanceWorkChanges> & Pick<FinanceWork, 'reporting'>) | null = null;
  financeError = '';
  readonly financeStatuses: { value: FinanceWorkStatus; label: string }[] = [
    { value: 'completed_billable', label: 'Teljesítve – számlázható' },
    { value: 'invoiced', label: 'Számlázva' },
    { value: 'paid', label: 'Fizetve' }
  ];
  private destroyed = false;
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  works: WorkItem[] = [];
  clients: WorkBoardClient[] = [];
  tenantUsers: TenantUserOption[] = [];
  selectedWork: WorkItem | null = null;
  customFields: WorkField[] = [];
  reportingEnabled = false;
  projectSizeGrouping = false;
  addServiceTypeCodeToWorkNumber = false;
  reportForm: WorkReporting = {};
  readonly projectSizes = PROJECT_SIZES;
  readonly reportPaymentStatuses = REPORT_PAYMENT_STATUSES;
  readonly catalogDefinitions = WORK_CATALOGS;
  catalogs: Record<WorkCatalog, WorkCatalogEntry[]> = { entities: [], serviceTypes: [] };
  readonly workCatalogLabel = workCatalogLabel;
  fieldChanges: WorkFieldValues = {};
  fieldFiles: WorkFieldFiles = {};
  expandedWorkIds = new Set<string>();
  detailView = false;
  loading = true;
  saving = false;
  search = '';
  statusFilter: WorkStatus | 'active' | 'all' | 'deleted' = 'active';
  sort: { active: string; direction: 'asc' | 'desc' } = { active: 'workNumber', direction: 'desc' };
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
  showClients = false;
  clientsLoading = false;
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
  protected referencesLoaded = false;
  private fieldOrder?: WorkFieldOrder;
  private hiddenFields = new Set<string>();
  private tenantColumnVisibility: Record<string, boolean> = {};
  private columnPreferences: { order?: string[]; visibility?: Record<string, boolean> } = {};
  columnDraft?: LayoutItem[];
  private resetColumnDraft = false;

  constructor(private board: WorkBoardService, private snackBar: MatSnackBar, public auth: AuthService, private route: ActivatedRoute) {}
  openWorkTransfer(target: WorkbookTransferTarget = 'works'): void {
    this.dialog.open(WorkTransferDialogComponent, { data: target, width: '580px', maxWidth: 'calc(100vw - 24px)', ariaLabelledBy: 'work-transfer-title' })
      .afterClosed().subscribe((saved) => {
        if (saved && !this.destroyed) {
          if (target === 'clients') void this.reloadClients();
          else void this.load();
        }
      });
  }
  ngOnInit(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(this.columnStorageKey()) ?? 'null');
      if (Array.isArray(saved?.order) && saved.order.every((id: unknown) => typeof id === 'string') &&
          saved.visibility && typeof saved.visibility === 'object') this.columnPreferences = saved;
    } catch { /* The table still works without browser storage. */ }
    const id = this.route.snapshot.queryParamMap.get('work');
    if (this.financeTenantId) {
      this.statusFilter = 'all';
      void this.loadFinance(this.financeTenantId, id);
      return;
    }
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const showClients = params.get('view') === 'clients' && this.auth.canEditFeature('workBoard');
      if (showClients === this.showClients) return;
      this.showClients = showClients;
      this.resetClientForm();
      if (showClients) {
        this.cancelForms();
        this.detailView = false;
        void this.reloadClients();
      } else if (!this.referencesLoaded && !this.loading) void this.load();
    });
    if (this.showClients) {
      this.loading = false;
      return;
    }
    void this.load().then(async () => {
      if (!id || this.showClients || this.showWorkForm || this.detailView) return;
      try {
        const work = this.works.find((item) => item.id === id) || await firstValueFrom(this.board.getWork(id));
        if (!this.showClients && !this.showWorkForm && !this.detailView) this.selectWork(work);
      } catch (error) { this.error(error, 'The work could not be opened.'); }
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadRequestId++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  get filteredWorks(): (WorkItem | FinanceWork)[] {
    return this.financeTenantId ? this.financeWorks : this.works;
  }

  operationalWork(work: WorkItem | FinanceWork): WorkItem | null {
    return 'subWorks' in work ? work : null;
  }

  get financeStatusOptions() {
    const index = this.financeStatuses.findIndex(({ value }) => value === this.financeWork?.status);
    return index < 0 ? [] : this.financeStatuses.slice(index, index + 2);
  }

  private async loadFinance(tenantId: string, workId?: string | null): Promise<void> {
    const requestId = ++this.loadRequestId;
    this.loading = true;
    this.financeError = '';
    try {
      const result = await firstValueFrom(this.board.listFinanceWorks(tenantId, {
        page: this.page, limit: this.pageSize, search: this.search.trim(), status: this.statusFilter,
        sort: this.sort.active, direction: this.sort.direction
      }));
      if (requestId !== this.loadRequestId) return;
      this.financeTenantName = result.tenant.name;
      this.financeWorks = result.works;
      this.page = result.pagination.page;
      this.totalWorks = result.pagination.total;
      this.totalPages = result.pagination.pages;
      this.referencesLoaded = true;
      if (this.page > this.totalPages) {
        this.page = this.totalPages;
        await this.loadFinance(tenantId, workId);
        return;
      }
    } catch (error: any) {
      if (requestId !== this.loadRequestId) return;
      this.financeWorks = [];
      this.financeError = error?.error?.error || 'A pénzügyi munkák betöltése sikertelen.';
      return;
    } finally {
      if (requestId === this.loadRequestId) this.loading = false;
    }
    if (workId) {
      try {
        const work = this.financeWorks.find(({ id }) => id === workId) || await firstValueFrom(this.board.getFinanceWork(tenantId, workId));
        if (requestId === this.loadRequestId && !this.detailView) this.selectWork(work);
      } catch (error) {
        if (requestId === this.loadRequestId) this.error(error, 'A munka megnyitása sikertelen.');
      }
    }
  }

  changeFinanceStatus(status: FinanceWorkStatus): void {
    const form = this.financeForm;
    const work = this.financeWork;
    if (!form || !work || status === form.status) return;
    if (status === work.status) {
      if (form.status === 'invoiced') form.invoiceDate = this.billingDay(work.invoiceDate);
      if (form.status === 'paid') form.paidAt = this.billingDay(work.paidAt);
    } else {
      if (status === 'invoiced') form.invoiceDate ||= this.today();
      if (status === 'paid') form.paidAt ||= this.today();
    }
    form.status = status;
  }

  changeFinanceCompletionDate(value: string | null): void {
    const form = this.financeForm;
    const work = this.financeWork;
    if (!form || !work) return;
    const previousDue = this.paymentDue(form.completionDate, work.paymentDeadlineDays);
    if (!form.invoicePaymentDeadline || form.invoicePaymentDeadline === previousDue) {
      form.invoicePaymentDeadline = this.paymentDue(value, work.paymentDeadlineDays);
    }
    form.completionDate = value;
  }

  async saveFinanceWork(): Promise<void> {
    if (!this.financeTenantId || !this.financeWork || !this.financeForm || this.saving) return;
    const form = this.financeForm;
    const work = this.financeWork;
    const changes: FinanceWorkChanges = { fieldRevision: form.fieldRevision };
    if (form.status !== work.status) changes.status = form.status;
    if (form.invoiceNumber.trim() !== work.invoiceNumber) changes.invoiceNumber = form.invoiceNumber.trim();
    for (const field of billingDateFields) {
      const date = form[field] || null;
      if (date !== this.billingDay(work[field])) changes[field] = date;
    }
    if (Object.keys(changes).length === 1) {
      this.backToTable();
      return;
    }

    this.saving = true;
    try {
      await firstValueFrom(this.board.updateFinanceWork(this.financeTenantId, work.id, changes));
      if (this.destroyed) return;
      this.backToTable();
      await this.load();
      if (!this.destroyed) this.notice('A pénzügyi adatok mentve.');
    } catch (error: any) {
      if (!this.destroyed) {
        this.error(error, 'A pénzügyi adatok mentése sikertelen.');
        if (error?.status === 409 || error?.status === 404) {
          this.backToTable();
          await this.load();
        }
      }
    } finally { this.saving = false; }
  }
  get pageStart(): number { return this.totalWorks ? (this.page - 1) * this.pageSize + 1 : 0; }
  get pageEnd(): number { return Math.min(this.page * this.pageSize, this.totalWorks); }

  async load(selectId?: string): Promise<void> {
    if (this.financeTenantId) return this.loadFinance(this.financeTenantId);
    const requestId = ++this.loadRequestId;
    this.loading = true;
    try {
      const [workPage, clients, users, settings] = await Promise.all([
        firstValueFrom(this.board.listWorks({ page: this.page, limit: this.pageSize, search: this.search.trim(),
          status: this.statusFilter, sort: this.sort.active, direction: this.sort.direction })),
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
        this.addServiceTypeCodeToWorkNumber = settings.addServiceTypeCodeToWorkNumber === true;
        this.customFields = settings.fields.filter((field) => !field.archived);
        this.fieldOrder = settings.fieldOrder;
        this.hiddenFields = new Set(settings.hiddenFields);
        this.tenantColumnVisibility = settings.columnVisibility ?? {};
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
  sortChanged({ active, direction }: Sort): void {
    if (!direction) return;
    this.sort = { active, direction };
    this.expandedWorkIds = new Set<string>();
    this.filtersChanged();
  }
  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) return;
    this.page = nextPage;
    this.expandedWorkIds = new Set<string>();
    void this.load();
  }
  pageSizeChanged(): void { this.page = 1; this.expandedWorkIds = new Set<string>(); void this.load(); }
  selectWork(work: WorkItem | FinanceWork): void {
    this.detailView = true;
    if ('subWorks' in work) {
      this.selectedWork = work;
      this.cancelForms();
      void this.loadDocuments(work.id);
    } else {
      this.financeWork = work;
      this.financeForm = {
        status: work.status, fieldRevision: work.fieldRevision, invoiceNumber: work.invoiceNumber,
        completionDate: this.billingDay(work.completionDate),
        invoiceDate: this.billingDay(work.invoiceDate),
        invoicePaymentDeadline: this.billingDay(work.invoicePaymentDeadline)
          ?? this.paymentDue(this.billingDay(work.completionDate), work.paymentDeadlineDays),
        paidAt: this.billingDay(work.paidAt),
        reporting: structuredClone(work.reporting)
      };
    }
  }
  toggleWorkExpansion(work: Pick<WorkItem, 'id'>, event?: Event): void {
    event?.stopPropagation();
    const next = new Set(this.expandedWorkIds);
    if (next.has(work.id)) next.delete(work.id);
    else next.add(work.id);
    this.expandedWorkIds = next;
  }
  isWorkExpanded(work: Pick<WorkItem, 'id'>): boolean { return this.expandedWorkIds.has(work.id); }
  trackWork(_: number, work: WorkItem | FinanceWork): string { return work.id; }
  trackSubWork(_: number, subWork: SubWorkItem): string { return subWork.id; }
  backToTable(): void {
    if (this.showClients) {
      if (!this.saving) void this.router.navigate([], { relativeTo: this.route, queryParams: { view: null }, queryParamsHandling: 'merge' });
      return;
    }
    this.cancelForms();
    this.detailView = false;
    this.documents = [];
    this.financeWork = null;
    this.financeForm = null;
  }
  startCreateWork(): void {
    this.workForm = this.emptyWorkForm(); this.fieldChanges = {}; this.fieldFiles = {};
    this.reportForm = {};
    this.editingWork = false; this.detailView = false; this.showWorkForm = true;
  }
  startEditWork(): void {
    if (!this.selectedWork) return;
    const w = this.selectedWork;
    this.workForm = {
      name: w.name, clientId: w.clientId || '', responsibleUserId: w.responsibleUserId || '', status: w.status, deadline: this.dateValue(w.deadline), description: w.description,
      entityId: w.entityId || '', serviceTypeId: w.serviceTypeId || '',
      currency: w.currency, totalAmount: w.totalAmount, costAmount: w.costAmount, subcontractor: w.subcontractor,
      paymentDeadlineDays: w.paymentDeadlineDays, offerDate: this.dateValue(w.offerDate), completionDate: this.billingFormDate(w.completionDate),
      invoiceDate: this.billingFormDate(w.invoiceDate), invoicePaymentDeadline: this.billingFormDate(w.invoicePaymentDeadline), invoiceNumber: w.invoiceNumber,
      contractSigned: w.contractSigned, performanceCertificate: w.performanceCertificate, paidAt: this.billingFormDate(w.paidAt)
    };
    this.fieldChanges = {};
    this.fieldFiles = {};
    this.reportForm = structuredClone(w.reporting || {});
    this.editingWork = true; this.showWorkForm = true;
  }
  changeWorkStatus(status: WorkStatus): void {
    const form = this.workForm;
    if (status === form.status) return;
    const existing = this.editingWork ? this.selectedWork : null;
    const today = this.localDate(this.today());
    if (status === 'completed_billable' && !form.completionDate) {
      this.changeWorkBillingInputs(today, form.paymentDeadlineDays);
    } else if (!this.showFrom('completion', status) && !existing?.completionDate) {
      this.changeWorkBillingInputs(null, form.paymentDeadlineDays);
    }
    if (status === 'invoiced') form.invoiceDate ||= today;
    else if (!this.showFrom('invoice', status) && !existing?.invoiceDate) form.invoiceDate = null;
    if (status === 'paid') form.paidAt ||= today;
    else if (form.status === 'paid' && !existing?.paidAt) form.paidAt = null;
    form.status = status;
  }

  changeWorkBillingInputs(completion: Date | null, days: number): void {
    const form = this.workForm;
    const previousDue = this.paymentDue(this.billingDay(form.completionDate), form.paymentDeadlineDays);
    const currentDue = this.billingDay(form.invoicePaymentDeadline);
    if (!currentDue || currentDue === previousDue) {
      const due = this.paymentDue(this.billingDay(completion), days);
      form.invoicePaymentDeadline = due ? this.localDate(due) : null;
    }
    form.completionDate = completion;
    form.paymentDeadlineDays = days;
  }

  async saveWork(): Promise<void> {
    if (!this.workForm.name.trim()) return this.notice('Work name is required.');
    if (this.requiresServiceTypeCode && !this.catalogs.serviceTypes.some((entry) =>
      entry.id === this.workForm.serviceTypeId && !!entry.code && !entry.archived)) {
      return this.notice('Select a service type with a 2- to 4-letter code.');
    }
    const active = this.customFields.filter((field) => this.isFieldVisible(field.id) && this.fieldRelevant(field, this.workForm.status));
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
      const reporting: WorkReporting = {
        backupId: this.reportForm.backupId,
        contractDate: this.reportForm.contractDate,
        ...(this.projectSizeGrouping ? { projectSize: this.reportForm.projectSize } : {})
      };
      const { completionDate, invoiceDate, invoicePaymentDeadline, paidAt, ...workData } = this.workForm;
      const formDates = { completionDate, invoiceDate, invoicePaymentDeadline, paidAt };
      const previous = this.editingWork ? this.selectedWork : null;
      const dates: Partial<Pick<WorkItem, typeof billingDateFields[number]>> = {};
      for (const field of billingDateFields) {
        const date = this.billingDay(formDates[field]);
        if (date !== this.billingDay(previous?.[field])) dates[field] = date ? date + 'T00:00:00.000Z' : null;
      }
      const payload = { ...workData, ...dates, name: workData.name.trim(),
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
  openClients(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'clients', work: null }, queryParamsHandling: 'merge' });
  }
  private resetClientForm(): void {
    this.clientForm = this.emptyClientForm();
    this.clientLookupFound = null;
    this.clientLookupLinked = false;
  }
  private async reloadClients(): Promise<void> {
    this.clientsLoading = true;
    try {
      this.clients = await firstValueFrom(this.board.listClients());
    } catch (error) { this.error(error, 'Clients could not be loaded.'); }
    finally { this.clientsLoading = false; }
  }
  get clientTaxNumberRequired(): boolean { return this.clientForm.country.trim().toUpperCase() === 'HU'; }
  changeClientTaxNumber(value: string): void {
    if (this.clientLookupFound) this.clientForm = this.emptyClientForm();
    this.clientForm.taxNumber = value;
    this.clientLookupFound = null;
    this.clientLookupLinked = false;
  }
  async lookupClient(): Promise<void> {
    const form = this.clientForm;
    const taxNumber = form.taxNumber.trim();
    if (!taxNumber) return;
    try {
      const result = await firstValueFrom(this.board.lookupClient(taxNumber));
      if (this.clientForm !== form || form.taxNumber.trim() !== taxNumber) return;
      this.clientLookupFound = result.client; this.clientLookupLinked = result.linked;
      if (result.client) this.clientForm = { ...result.client };
      else this.notice('No existing company found. Enter the company details to create it.');
    } catch (error: any) { this.error(error, 'Client lookup failed.'); }
  }
  async saveClient(): Promise<void> {
    if (this.saving || this.clientsLoading || this.clientLookupLinked) return;
    if (!this.clientForm.name.trim()) return this.notice('Company name is required.');
    if (this.clientTaxNumberRequired && !this.clientForm.taxNumber.trim()) return this.notice('Tax number is required for Hungarian clients.');
    this.saving = true;
    const form = this.clientForm;
    try {
      const result = await firstValueFrom(this.board.createOrLinkClient(form));
      if (this.destroyed) return;
      this.clients = [...this.clients.filter(({ id }) => id !== result.client.id), result.client]
        .sort((a, b) => a.name.localeCompare(b.name));
      this.workForm.clientId = result.client.id;
      if (this.clientForm === form) this.resetClientForm();
      this.notice(result.matchedExisting ? 'Existing company linked to this tenant.' : 'Client created.');
    } catch (error: any) { this.error(error, 'Client could not be saved.'); }
    finally { this.saving = false; }
  }
  statusLabel(status: WorkStatus): string { return (this.financeTenantId ? this.financeStatuses : this.statuses).find((item) => item.value === status)?.label || status; }
  backupLabel(id?: string): string { return this.tenantUsers.find((user) => user.id === id)?.fullName || '—'; }
  reportPaymentLabel(status?: string): string { return this.reportPaymentStatuses.find((item) => item.id === status)?.label || '—'; }
  get editorValues(): WorkFieldValues { return (this.editingWork && this.selectedWork?.customFields) || {}; }
  get visibleCatalogs() { return this.catalogDefinitions.filter((catalog) => this.hasCatalogOptions(catalog.key)); }
  hasCatalogOptions(catalog: WorkCatalog): boolean { return this.catalogs[catalog].some((entry) => !entry.archived); }
  get requiresServiceTypeCode(): boolean { return !this.editingWork && this.addServiceTypeCodeToWorkNumber; }
  catalogOptions(catalog: WorkCatalog, current: string): WorkCatalogEntry[] {
    return this.catalogs[catalog].filter((entry) => !entry.archived || entry.id === current);
  }
  catalogLabel(catalog: WorkCatalog, id?: string | null): string {
    return this.catalogs[catalog].find((entry) => entry.id === id)?.label || '—';
  }
  isFieldVisible(id: string): boolean { return !this.hiddenFields.has(id); }
  get showNextActions(): boolean {
    return this.auth.canAccessFeature('effortTracking') && (this.isFieldVisible('nextAction') || this.isFieldVisible('actionDue'));
  }

  orderedFields(card: WorkFieldCard, includeServiceType = false): LayoutItem[] {
    return orderLayout(cardLayout(card, this.customFields, this.hiddenFields)
      .filter((item) => item.visible || (includeServiceType && item.id === 'serviceTypeId')), this.fieldOrder?.[card]);
  }
  customField(id: string): WorkField | undefined { return this.customFields.find((field) => field.id === id); }
  get hasExecutionInputs(): boolean {
    return this.orderedFields('execution').some(({ id }) => id !== 'margin');
  }
  get hasInvoiceInputs(): boolean {
    return this.orderedFields('invoice').some(({ id }) =>
      id !== 'paymentDeadline' && (id !== 'paidAt' || this.workForm.status === 'paid' || this.workForm.paidAt));
  }
  hasCardDetails(card: WorkFieldCard, work: WorkItem): boolean {
    return this.orderedFields(card).some(({ id }) => {
      if (this.customField(id)) return true;
      const value = this.detailFieldValue(card, id, work);
      return value !== null && value !== '—';
    });
  }
  detailFieldValue(card: WorkFieldCard, id: string, work: WorkItem): string | null {
    const report = work.reporting;
    const date = (value: string | null | undefined, billing = false) =>
      value ? formatDate(billing ? this.billingDay(value) ?? value : value, 'yyyy.MM.dd', 'en-US') : null;
    const money = (amount: number) => this.formatMoney(amount, work.currency);
    switch (id) {
      case 'name': return work.name;
      case 'status': return work.archivedAt ? 'Deleted' : this.statusLabel(work.status);
      case 'client': return work.customer || '—';
      case 'entityId': return this.hasCatalogOptions('entities') || work.entityId ? this.catalogLabel('entities', work.entityId) : null;
      case 'serviceTypeId': return this.hasCatalogOptions('serviceTypes') || work.serviceTypeId ? this.catalogLabel('serviceTypes', work.serviceTypeId) : null;
      case 'responsible': return work.responsible || '—';
      case 'projectSize': return this.projectSizeGrouping ? report?.projectSize || 'Automatic' : null;
      case 'description': return work.description || null;
      case 'totalAmount': return money(work.totalAmount);
      case 'currency': return work.currency;
      case 'offerDate': return date(work.offerDate);
      case 'contractDate': return date(report?.contractDate);
      case 'deadline': return date(work.deadline);
      case 'paymentDays': return work.paymentDeadlineDays ? work.paymentDeadlineDays + ' days' : null;
      case 'cost': return money(work.costAmount);
      case 'margin': return formatNumber(work.marginPercent, 'en-US', '1.0-2') + '%';
      case 'subcontractor': return work.subcontractor || null;
      case 'contract': return work.contractSigned ? 'Signed' : 'Not signed';
      case 'completionDate': return date(work.completionDate, true);
      case 'paymentDeadline': return card === 'completion' && this.showFrom('invoice', work.status)
        ? null : date(work.invoicePaymentDeadline, true);
      case 'certificate': return work.performanceCertificate ? 'Signed' : 'Not signed';
      case 'invoiceNumber': return work.invoiceNumber || null;
      case 'invoiceDate': return date(work.invoiceDate, true);
      case 'paidAt': return date(work.paidAt, true);
      case 'backup': return this.backupLabel(report?.backupId);
      case 'nextAction': return report?.nextAction || '—';
      case 'actionDue': return report?.actionDue || '—';
      case 'paymentStatus': return this.reportPaymentLabel(report?.paymentStatus);
      case 'invoiced': return report?.invoicedAmount == null ? '—' : money(report.invoicedAmount);
      case 'paid': return report?.paidAmount == null ? '—' : money(report.paidAmount);
      default: return null;
    }
  }
  get defaultColumns(): LayoutItem[] {
    const columns = [
      { id: 'workNumber', label: this.financeTenantId ? 'Munkaszám' : 'Work no.' },
      { id: 'name', label: this.financeTenantId ? 'Ügyfél / munka' : this.isFieldVisible('client') ? 'Client / work' : 'Work' },
      ...this.visibleCatalogs.map(({ reference, label }) => ({ id: reference, label })),
      ...this.financeTenantId ? [] : [{ id: 'responsible', label: 'Responsible' }],
      { id: 'status', label: this.financeTenantId ? 'Státusz' : 'Status' },
      ...this.financeTenantId ? [] : [{ id: 'deadline', label: 'Deadline' }],
      { id: 'totalAmount', label: this.financeTenantId ? 'Szerződéses összeg' : 'Value' },
      ...this.financeTenantId
        ? [{ id: 'invoiceNumber', label: 'Számlaszám' }, { id: 'paymentDeadline', label: 'Fizetési határidő' }]
        : [{ id: 'subWorkCount', label: 'Sub-works' }]
    ].filter(({ id }) => this.isFieldVisible(id))
      .map((column) => ({ ...column, visible: this.tenantColumnVisibility[column.id] ?? true }));
    return [...columns, ...this.customFields.filter(({ id }) => this.isFieldVisible(id))
      .map((field) => ({ id: 'field:' + field.id, label: field.label, visible: this.tenantColumnVisibility[field.id] ?? field.showInList }))];
  }
  get columnOptions(): LayoutItem[] {
    return orderLayout(this.defaultColumns, this.columnPreferences.order).map((column) => ({
      ...column, visible: typeof this.columnPreferences.visibility?.[column.id] === 'boolean'
        ? this.columnPreferences.visibility[column.id] : column.visible
    }));
  }
  get visibleColumns(): LayoutItem[] {
    const options = this.columnDraft ?? this.columnOptions;
    const visible = options.filter((column) => column.visible);
    return visible.length ? visible : this.defaultColumns.slice(0, 1).map((column) => ({ ...column, visible: true }));
  }
  get availableColumns(): LayoutItem[] {
    const visibleIds = new Set(this.visibleColumns.map(({ id }) => id));
    return (this.columnDraft ?? this.columnOptions).filter(({ id }) => !visibleIds.has(id));
  }
  changeColumns(items: LayoutItem[]): void {
    const visible = items.filter((item) => item.visible);
    const selected = new Set(visible.map(({ id }) => id));
    this.columnDraft = [...visible, ...this.defaultColumns
      .filter(({ id }) => !selected.has(id)).map((column) => ({ ...column, visible: false }))];
    this.resetColumnDraft = false;
  }
  showColumn(column: LayoutItem): void { this.changeColumns([...this.visibleColumns, { ...column, visible: true }]); }
  resetColumns(): void { this.columnDraft = this.defaultColumns; this.resetColumnDraft = true; }
  cancelColumns(): void { this.columnDraft = undefined; this.resetColumnDraft = false; }
  hasWorkNumber(columns: LayoutItem[]): boolean { return columns.some(({ id }) => id === 'workNumber'); }
  saveColumns(): void {
    if (!this.columnDraft) return;
    const draft = this.columnDraft;
    this.columnPreferences = this.resetColumnDraft ? {} : {
      order: draft.map(({ id }) => id), visibility: Object.fromEntries(draft.map(({ id, visible }) => [id, visible === true]))
    };
    try {
      if (this.resetColumnDraft) localStorage.removeItem(this.columnStorageKey());
      else localStorage.setItem(this.columnStorageKey(), JSON.stringify(this.columnPreferences));
    }
    catch { this.notice('Column settings are available for this view only.'); }
    this.cancelColumns();
  }
  private columnStorageKey(): string {
    const user = this.auth.getCurrentUser();
    const tenant = this.financeTenantId ?? this.auth.getTenantContextId() ?? user?.tenantId;
    return JSON.stringify(['epds:work-table-columns', user?.id ?? user?.userId, tenant, !!this.financeTenantId]);
  }
  listField(work: WorkItem, field: WorkField): string {
    return this.fieldRelevant(field, work.status) ? displayWorkField(field, work.customFields?.[field.id]) : '—';
  }
  private fieldRelevant(field: WorkField, status: WorkStatus): boolean {
    const card = field.card;
    return card === 'basic' || card === 'documents' || card === 'reporting' || this.showFrom(card, status);
  }
  showFrom(stage: 'offer' | 'execution' | 'completion' | 'invoice' | 'payment', status: WorkStatus = this.workForm.status): boolean {
    const required = { offer: 1, execution: 2, completion: 3, invoice: 4, payment: 5 }[stage];
    return this.statusRank[status] >= required;
  }
  formatMoney(value: number, currency = 'HUF'): string { return new Intl.NumberFormat('hu-HU', { style: 'currency', currency, maximumFractionDigits: currency === 'HUF' ? 0 : 2 }).format(value || 0); }
  isOverdue(value: string | null): boolean { return Boolean(value && new Date(value).getTime() < new Date().setHours(0, 0, 0, 0)); }
  private today(): string {
    return billingCalendar.format(new Date());
  }

  private localDate(day: string): Date {
    return new Date(day + 'T00:00:00');
  }

  private paymentDue(completion: string | null, days: number): string | null {
    if (!completion || !Number.isSafeInteger(days) || days < 0) return null;
    const date = new Date(completion);
    date.setUTCDate(date.getUTCDate() + days);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  billingDay(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return typeof value === 'string' ? billingCalendar.format(date) : formatDate(date, 'yyyy-MM-dd', 'en-US');
  }

  isBillingOverdue(value: string | null): boolean {
    const due = this.billingDay(value);
    return Boolean(due && due < this.today());
  }

  private billingFormDate(value: string | null): Date | null {
    const day = this.billingDay(value);
    return day ? this.localDate(day) : null;
  }
  private dateValue(value: string | null): Date | null { return value ? new Date(value) : null; }
  private notice(message: string): void { this.snackBar.open(message, 'OK', { duration: 3000 }); }
  private error(error: any, fallback: string): void { this.snackBar.open(error?.error?.error || fallback, 'OK', { duration: 4500 }); }
  private emptyWorkForm(): WorkForm { return { name: '', clientId: '', entityId: '', serviceTypeId: '', responsibleUserId: '', status: 'inquiry', deadline: null, description: '', currency: this.defaultCurrency, totalAmount: 0, costAmount: 0, subcontractor: '', paymentDeadlineDays: 30, offerDate: null, completionDate: null, invoiceDate: null, invoicePaymentDeadline: null, invoiceNumber: '', contractSigned: false, performanceCertificate: false, paidAt: null }; }
  private emptySubWorkForm(): SubWorkForm { return { name: '', responsibleUserId: '', status: 'inquiry', deadline: null, description: '', plannedHours: 0, amount: 0, percentage: 0, performanceCertificateRequired: false, performanceCertificateSigned: false, invoiceNumber: '', invoiceDate: null, invoicePaymentDeadline: null, paidAmount: 0, paidAt: null }; }
  private emptyClientForm(): ClientPayload { return { taxNumber: '', name: '', country: 'HU', postalCode: '', city: '', address: '', email: '', phone: '' }; }
}
