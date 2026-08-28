import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { ClientPayload, SubWorkItem, SubWorkPayload, TenantUserOption, WorkBoardClient, WorkBoardService, WorkItem, WorkPayload, WorkStatus } from '../services/work-board.service';

type WorkForm = {
  name: string; clientId: string; responsibleUserId: string; status: WorkStatus; deadline: Date | null; description: string;
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
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule, MatNativeDateModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, MatSnackBarModule],
  templateUrl: './work-board.component.html',
  styleUrl: './work-board.component.scss'
})
export class WorkBoardComponent implements OnInit {
  works: WorkItem[] = [];
  clients: WorkBoardClient[] = [];
  tenantUsers: TenantUserOption[] = [];
  selectedWork: WorkItem | null = null;
  expandedWorkIds = new Set<string>();
  detailView = false;
  loading = true;
  saving = false;
  search = '';
  statusFilter: WorkStatus | 'active' | 'all' = 'active';
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
    { value: 'inquiry', label: 'Inquiry' }, { value: 'offer', label: 'Offer' }, { value: 'in_progress', label: 'In progress' },
    { value: 'completed_billable', label: 'Completed, billable' }, { value: 'invoiced', label: 'Invoiced' },
    { value: 'paid', label: 'Paid' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }
  ];
  readonly terminalStatuses = new Set<WorkStatus>(['completed_billable', 'invoiced', 'paid', 'closed', 'cancelled']);
  private readonly statusRank: Record<WorkStatus, number> = {
    inquiry: 0, offer: 1, in_progress: 2, completed_billable: 3,
    invoiced: 4, paid: 5, closed: 6, cancelled: 6
  };

  constructor(private board: WorkBoardService, private snackBar: MatSnackBar, public auth: AuthService) {}
  ngOnInit(): void { void this.load(); }

  get filteredWorks(): WorkItem[] {
    const needle = this.search.trim().toLowerCase();
    return this.works.filter((work) => {
      const matchesText = !needle || `${work.workNumber} ${work.name} ${work.customer} ${work.responsible}`.toLowerCase().includes(needle);
      const matchesStatus = this.statusFilter === 'all' || (this.statusFilter === 'active' ? !this.terminalStatuses.has(work.status) : work.status === this.statusFilter);
      return matchesText && matchesStatus;
    });
  }
  get activeCount(): number { return this.works.filter((work) => !this.terminalStatuses.has(work.status)).length; }
  get overdueCount(): number { return this.works.filter((work) => !this.terminalStatuses.has(work.status) && this.isOverdue(work.deadline)).length; }
  get totalActiveValue(): number { return this.works.filter((work) => !this.terminalStatuses.has(work.status)).reduce((sum, work) => sum + work.totalAmount, 0); }

  async load(selectId?: string): Promise<void> {
    this.loading = true;
    try {
      [this.works, this.clients, this.tenantUsers] = await Promise.all([
        firstValueFrom(this.board.listWorks()), firstValueFrom(this.board.listClients()), firstValueFrom(this.board.listTenantUsers())
      ]);
      const id = selectId || this.selectedWork?.id || this.works[0]?.id;
      this.selectedWork = this.works.find((work) => work.id === id) || null;
    } catch (error: any) { this.error(error, 'Works could not be loaded.'); }
    finally { this.loading = false; }
  }
  selectWork(work: WorkItem): void { this.selectedWork = work; this.cancelForms(); this.detailView = true; }
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
  backToTable(): void { this.cancelForms(); this.detailView = false; }
  startCreateWork(): void { this.workForm = this.emptyWorkForm(); this.editingWork = false; this.detailView = false; this.showClientPanel = false; this.showWorkForm = true; }
  startEditWork(): void {
    if (!this.selectedWork) return;
    const w = this.selectedWork;
    this.workForm = {
      name: w.name, clientId: w.clientId || '', responsibleUserId: w.responsibleUserId || '', status: w.status, deadline: this.dateValue(w.deadline), description: w.description,
      currency: w.currency, totalAmount: w.totalAmount, costAmount: w.costAmount, subcontractor: w.subcontractor,
      paymentDeadlineDays: w.paymentDeadlineDays, offerDate: this.dateValue(w.offerDate), completionDate: this.dateValue(w.completionDate),
      invoiceDate: this.dateValue(w.invoiceDate), invoicePaymentDeadline: this.dateValue(w.invoicePaymentDeadline), invoiceNumber: w.invoiceNumber,
      contractSigned: w.contractSigned, performanceCertificate: w.performanceCertificate
    };
    this.editingWork = true; this.showWorkForm = true;
  }
  async saveWork(): Promise<void> {
    if (!this.workForm.name.trim()) return this.notice('Work name is required.');
    this.saving = true;
    try {
      const payload = { ...this.workForm, name: this.workForm.name.trim() } as WorkPayload;
      const saved = this.editingWork && this.selectedWork
        ? await firstValueFrom(this.board.updateWork(this.selectedWork.id, payload))
        : await firstValueFrom(this.board.createWork(payload));
      this.showWorkForm = false; await this.load(saved.id); this.detailView = true; this.notice('Work saved.');
    } catch (error: any) { this.error(error, 'Work could not be saved.'); }
    finally { this.saving = false; }
  }
  async archiveWork(): Promise<void> {
    if (!this.selectedWork || !confirm(`Archive ${this.selectedWork.workNumber} · ${this.selectedWork.name}?`)) return;
    try { await firstValueFrom(this.board.archiveWork(this.selectedWork.id)); this.selectedWork = null; this.detailView = false; await this.load(); }
    catch (error: any) { this.error(error, 'Work could not be archived.'); }
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
  private emptyWorkForm(): WorkForm { return { name: '', clientId: '', responsibleUserId: '', status: 'inquiry', deadline: null, description: '', currency: 'HUF', totalAmount: 0, costAmount: 0, subcontractor: '', paymentDeadlineDays: 30, offerDate: null, completionDate: null, invoiceDate: null, invoicePaymentDeadline: null, invoiceNumber: '', contractSigned: false, performanceCertificate: false }; }
  private emptySubWorkForm(): SubWorkForm { return { name: '', responsibleUserId: '', status: 'inquiry', deadline: null, description: '', plannedHours: 0, amount: 0, percentage: 0, performanceCertificateRequired: false, performanceCertificateSigned: false, invoiceNumber: '', invoiceDate: null, invoicePaymentDeadline: null, paidAmount: 0, paidAt: null }; }
  private emptyClientForm(): ClientPayload { return { taxNumber: '', name: '', country: 'HU', postalCode: '', city: '', address: '', email: '', phone: '' }; }
}
