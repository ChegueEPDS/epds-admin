import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDividerModule } from '@angular/material/divider';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RichTextEditorComponent } from '../../shared/rich-text-editor/rich-text-editor.component';
import {
  AddressEnvironment,
  ApplicationServerType,
  ContactArea,
  CurrencyCode,
  DatabaseServerType,
  InfrastructureGroup,
  LicenseCustomer,
  LicensePayload,
  ObjectLimitOption
} from '../../services/license.service';

export type LicenseDialogResult =
  | { action: 'save'; payload: LicensePayload }
  | { action: 'delete' };

const OBJECT_LIMIT_OPTIONS: ObjectLimitOption[] = ['1000', '6000', '11000', '16000', '21000', '26000', '31000', 'custom', 'unlimited'];
const CONTACT_AREAS: ContactArea[] = ['IT', 'Üzlet', 'Beszerzés'];
const ADDRESS_ENVIRONMENTS: AddressEnvironment[] = ['prod', 'test', 'dev'];
const CURRENCIES: CurrencyCode[] = ['HUF', 'EUR', 'USD'];
const DATABASE_SERVER_TYPES: DatabaseServerType[] = ['MSSQL', 'PostgreSQL', 'Oracle'];
const APPLICATION_SERVER_TYPES: ApplicationServerType[] = ['Linux', 'Windows'];

@Component({
  selector: 'app-license-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatDividerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    RichTextEditorComponent
  ],
  templateUrl: './license-dialog.component.html',
  styleUrl: './license-dialog.component.scss'
})
export class LicenseDialogComponent {
  objectLimitOptions = OBJECT_LIMIT_OPTIONS;
  contactAreas = CONTACT_AREAS;
  addressEnvironments = ADDRESS_ENVIRONMENTS;
  currencies = CURRENCIES;
  databaseServerTypes = DATABASE_SERVER_TYPES;
  applicationServerTypes = APPLICATION_SERVER_TYPES;
  model: LicensePayload;
  expiryDate: Date | null = null;
  isEditing = false;
  visibleVpnPasswords = new Set<number>();

  constructor(
    private dialogRef: MatDialogRef<LicenseDialogComponent, LicenseDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: { license?: LicenseCustomer }
  ) {
    this.model = this.buildModel(data.license);
    this.expiryDate = this.parseDateInput(this.model.expiresAt);
    this.isEditing = !data.license;
    if (this.isEditing) this.ensureDefaultEditRows();
  }

  private buildModel(license?: LicenseCustomer): LicensePayload {
    return {
      customerName: license?.customerName || '',
      status: license?.status || 'active',
      objectLimitOption: license?.objectLimitOption || '1000',
      customObjectLimit: license?.customObjectLimit || null,
      expiresAt: this.toDateInputValue(license?.expiresAt),
      databaseServerAddress: license?.databaseServerAddress || '',
      databaseServerType: license?.databaseServerType || null,
      applicationServerAddress: license?.applicationServerAddress || '',
      applicationServerType: license?.applicationServerType || null,
      applicationAddress: license?.applicationAddress || '',
      databaseAddresses: (license?.databaseAddresses?.length
        ? license.databaseAddresses
        : (license?.databaseServerAddress || license?.databaseServerType)
          ? [{ address: license.databaseServerAddress || '', environment: 'prod', databaseType: license.databaseServerType || null }]
          : []
      ).map((item) => ({
        address: item.address || '',
        environment: this.coerceEnvironment(item.environment),
        databaseType: item.databaseType || null
      })),
      applicationAddresses: (license?.applicationAddresses?.length
        ? license.applicationAddresses
        : license?.applicationAddress
          ? [{ address: license.applicationAddress, environment: 'prod' }]
          : []
      ).map((item) => ({
        address: item.address || '',
        environment: this.coerceEnvironment(item.environment)
      })),
      infrastructureGroups: this.buildInfrastructureGroups(license),
      accessAddresses: (license?.accessAddresses || []).map((item) => ({
        address: item.address || '',
        environment: 'prod' as AddressEnvironment
      })).slice(0, 1),
      mobileApp: license?.mobileApp || false,
      licensePrice: license?.licensePrice || 0,
      licenseCurrency: license?.licenseCurrency || 'HUF',
      supportPrice: license?.supportPrice || 0,
      supportCurrency: license?.supportCurrency || 'HUF',
      contacts: (license?.contacts || []).map((contact) => ({
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        area: contact.area || null
      })),
      vpnApp: license?.vpnApp || '',
      twoFactorApp: license?.twoFactorApp || '',
      vpnCredentials: (license?.vpnCredentials || []).map((credential) => ({
        username: credential.username || '',
        password: credential.password || ''
      })),
      notesHtml: license?.notesHtml || ''
    };
  }

  objectLimitLabel(option: ObjectLimitOption): string {
    if (option === 'custom') return 'Custom';
    if (option === 'unlimited') return 'Unlimited';
    return this.formatObjectCount(option);
  }

  objectLimitText(): string {
    if (this.model.objectLimitOption === 'unlimited') return 'Unlimited';
    const value = this.model.objectLimitOption === 'custom' ? this.model.customObjectLimit : Number(this.model.objectLimitOption);
    return `${this.formatObjectCount(value)}`;
  }

  private formatObjectCount(value: number | string | null | undefined): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    return String(Math.trunc(numericValue)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  statusText(): string {
    if (this.model.status === 'inactive') return 'Inactive';
    if (this.isExpired()) return 'Expired';
    if (this.expiresSoon()) return 'Expires soon';
    return 'Active';
  }

  statusIcon(): string {
    if (this.model.status === 'inactive') return 'pause_circle';
    if (this.isExpired()) return 'event_busy';
    if (this.expiresSoon()) return 'warning';
    return 'check_circle';
  }

  statusClass(): string {
    if (this.model.status === 'inactive') return 'status-inactive';
    if (this.isExpired()) return 'status-expired';
    if (this.expiresSoon()) return 'status-warning';
    return 'status-active';
  }

  emptyText(value: string | null | undefined): string {
    return String(value || '').trim() || '-';
  }

  priceText(value: number | null | undefined, currency: CurrencyCode | null | undefined): string {
    return new Intl.NumberFormat('hu-HU', {
      style: 'currency',
      currency: currency || 'HUF',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0
    }).format(Number(value || 0));
  }

  currencyLabel(value: CurrencyCode): string {
    if (value === 'USD') return 'Dollar';
    if (value === 'EUR') return 'Euro';
    return 'Forint';
  }

  phoneText(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const normalized = raw.replace(/[^\d+]/g, '');
    if (normalized.startsWith('+36') && normalized.length === 12) {
      return `${normalized.slice(0, 3)} ${normalized.slice(3, 5)} ${normalized.slice(5, 8)} ${normalized.slice(8)}`;
    }
    if (/^06\d{9}$/.test(normalized)) {
      return `${normalized.slice(0, 2)} ${normalized.slice(2, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
    }
    return raw;
  }

  isVpnPasswordVisible(index: number): boolean {
    return this.visibleVpnPasswords.has(index);
  }

  toggleVpnPassword(index: number): void {
    if (this.visibleVpnPasswords.has(index)) {
      this.visibleVpnPasswords.delete(index);
    } else {
      this.visibleVpnPasswords.add(index);
    }
  }

  environmentLabel(value: AddressEnvironment | string | null | undefined): string {
    if (value === 'prod') return 'Prod';
    if (value === 'test') return 'Test';
    if (value === 'dev') return 'Dev';
    return '-';
  }

  environmentClass(value: AddressEnvironment | null | undefined): string {
    if (value === 'test') return 'environment-test';
    if (value === 'dev') return 'environment-dev';
    return 'environment-prod';
  }

  contactAreaClass(value: ContactArea | null | undefined): string {
    if (value === 'IT') return 'contact-area-it';
    if (value === 'Üzlet') return 'contact-area-business';
    if (value === 'Beszerzés') return 'contact-area-procurement';
    return 'contact-area-empty';
  }

  private coerceEnvironment(value: AddressEnvironment | string | null | undefined): AddressEnvironment {
    return value === 'test' || value === 'dev' || value === 'prod' ? value : 'prod';
  }

  private buildInfrastructureGroups(license?: LicenseCustomer): InfrastructureGroup[] {
    if (license?.infrastructureGroups?.length) {
      return license.infrastructureGroups.map((group) => ({
        environment: this.coerceEnvironment(group.environment),
        applicationServerAddress: group.applicationServerAddress || '',
        applicationServerType: group.applicationServerType || null,
        databaseServerAddress: group.databaseServerAddress || '',
        databaseServerType: group.databaseServerType || null,
        applicationAddress: group.applicationAddress || ''
      }));
    }

    const groups = new Map<AddressEnvironment, InfrastructureGroup>();
    const ensureGroup = (environment: AddressEnvironment | string | null | undefined): InfrastructureGroup => {
      const key = this.coerceEnvironment(environment);
      const existing = groups.get(key);
      if (existing) return existing;
      const group: InfrastructureGroup = {
        environment: key,
        applicationServerAddress: '',
        applicationServerType: null,
        databaseServerAddress: '',
        databaseServerType: null,
        applicationAddress: ''
      };
      groups.set(key, group);
      return group;
    };

    if (license?.applicationServerAddress || license?.applicationServerType) {
      const group = ensureGroup('prod');
      group.applicationServerAddress = license.applicationServerAddress || '';
      group.applicationServerType = license.applicationServerType || null;
    }
    for (const item of license?.databaseAddresses || []) {
      const group = ensureGroup(item.environment);
      if (!group.databaseServerAddress) group.databaseServerAddress = item.address || '';
      if (!group.databaseServerType) group.databaseServerType = item.databaseType || null;
    }
    for (const item of license?.applicationAddresses || []) {
      const group = ensureGroup(item.environment);
      if (!group.applicationAddress) group.applicationAddress = item.address || '';
    }
    if (!license?.applicationAddresses?.length && license?.applicationAddress) {
      ensureGroup('prod').applicationAddress = license.applicationAddress;
    }

    return Array.from(groups.values()).filter((group) => (
      group.applicationServerAddress ||
      group.applicationServerType ||
      group.databaseServerAddress ||
      group.databaseServerType ||
      group.applicationAddress
    ));
  }

  maskedPassword(value: string | null | undefined): string {
    return value ? '••••••••' : '-';
  }

  save(): void {
    const customerName = this.model.customerName.trim();
    const customObjectLimit = Number(this.model.customObjectLimit);
    const licensePrice = Number(this.model.licensePrice || 0);
    const supportPrice = Number(this.model.supportPrice || 0);
    const expiresAt = this.toDateOnlyString(this.expiryDate);
    const infrastructureGroups = this.model.infrastructureGroups
      .map((group) => ({
        environment: group.environment || 'prod',
        applicationServerAddress: String(group.applicationServerAddress || '').trim(),
        applicationServerType: group.applicationServerType || null,
        databaseServerAddress: String(group.databaseServerAddress || '').trim(),
        databaseServerType: group.databaseServerType || null,
        applicationAddress: String(group.applicationAddress || '').trim()
      }))
      .filter((group) => (
        group.applicationServerAddress ||
        group.applicationServerType ||
        group.databaseServerAddress ||
        group.databaseServerType ||
        group.applicationAddress
      ));
    if (!customerName || !this.model.status || !this.model.objectLimitOption || !expiresAt) return;
    if (this.model.objectLimitOption === 'custom' && (!Number.isInteger(customObjectLimit) || customObjectLimit < 1)) return;
    if (!Number.isInteger(licensePrice) || licensePrice < 0 || !Number.isInteger(supportPrice) || supportPrice < 0) return;

    this.dialogRef.close({
      action: 'save',
      payload: {
        ...this.model,
        customerName,
        status: this.model.status,
        objectLimitOption: this.model.objectLimitOption,
        customObjectLimit: this.model.objectLimitOption === 'custom' ? customObjectLimit : null,
        expiresAt,
        infrastructureGroups,
        databaseAddresses: infrastructureGroups
          .map((group) => ({
            address: group.databaseServerAddress,
            environment: group.environment,
            databaseType: group.databaseServerType || null
          }))
          .filter((item) => item.address || item.databaseType),
        databaseServerAddress: infrastructureGroups[0]?.databaseServerAddress || '',
        databaseServerType: infrastructureGroups[0]?.databaseServerType || null,
        applicationServerAddress: infrastructureGroups[0]?.applicationServerAddress || '',
        applicationServerType: infrastructureGroups[0]?.applicationServerType || null,
        applicationAddresses: infrastructureGroups
          .map((group) => ({
            address: group.applicationAddress,
            environment: group.environment
          }))
          .filter((item) => item.address),
        applicationAddress: infrastructureGroups[0]?.applicationAddress || '',
        accessAddresses: String(this.model.accessAddresses[0]?.address || '').trim()
          ? [{ address: String(this.model.accessAddresses[0]?.address || '').trim(), environment: 'prod' }]
          : [],
        mobileApp: this.model.mobileApp === true,
        licensePrice,
        licenseCurrency: this.model.licenseCurrency || 'HUF',
        supportPrice,
        supportCurrency: this.model.supportCurrency || 'HUF',
        contacts: this.model.contacts
          .map((contact) => ({
            name: String(contact.name || '').trim(),
            email: String(contact.email || '').trim(),
            phone: String(contact.phone || '').trim(),
            area: contact.area || null
          }))
          .filter((contact) => contact.name || contact.email || contact.phone || contact.area),
        vpnApp: this.model.vpnApp.trim(),
        twoFactorApp: this.model.twoFactorApp.trim(),
        vpnCredentials: this.model.vpnCredentials
          .map((credential) => ({
            username: String(credential.username || '').trim(),
            password: String(credential.password || '')
          }))
          .filter((credential) => credential.username || credential.password),
        notesHtml: this.model.notesHtml
      }
    });
  }

  cancelEdit(): void {
    if (!this.data.license) {
      this.dialogRef.close();
      return;
    }
    this.model = this.buildModel(this.data.license);
    this.expiryDate = this.parseDateInput(this.model.expiresAt);
    this.visibleVpnPasswords.clear();
    this.ensureDefaultEditRows();
    this.isEditing = false;
  }

  startEdit(): void {
    this.visibleVpnPasswords.clear();
    this.ensureDefaultEditRows();
    this.isEditing = true;
  }

  deleteFromSheet(): void {
    this.dialogRef.close({ action: 'delete' });
  }

  addContact(): void {
    this.model.contacts = [
      ...this.model.contacts,
      { name: '', email: '', phone: '', area: null }
    ];
  }

  removeContact(index: number): void {
    this.model.contacts = this.model.contacts.filter((_, currentIndex) => currentIndex !== index);
    if (!this.model.contacts.length) this.addContact();
  }

  private ensureDefaultEditRows(): void {
    if (!this.model.contacts.length) this.addContact();
    if (!this.model.infrastructureGroups.length) this.addInfrastructureGroup();
    if (!this.model.accessAddresses.length) this.model.accessAddresses = [{ address: '', environment: 'prod' }];
    if (this.model.accessAddresses.length > 1) this.model.accessAddresses = [this.model.accessAddresses[0]];
    this.model.accessAddresses[0].environment = 'prod';
  }

  addInfrastructureGroup(): void {
    this.model.infrastructureGroups = [
      ...this.model.infrastructureGroups,
      {
        environment: 'prod',
        applicationServerAddress: '',
        applicationServerType: null,
        databaseServerAddress: '',
        databaseServerType: null,
        applicationAddress: ''
      }
    ];
  }

  removeInfrastructureGroup(index: number): void {
    this.model.infrastructureGroups = this.model.infrastructureGroups.filter((_, currentIndex) => currentIndex !== index);
    if (!this.model.infrastructureGroups.length) this.addInfrastructureGroup();
  }

  addVpnCredential(): void {
    this.model.vpnCredentials = [
      ...this.model.vpnCredentials,
      { username: '', password: '' }
    ];
  }

  removeVpnCredential(index: number): void {
    this.model.vpnCredentials = this.model.vpnCredentials.filter((_, currentIndex) => currentIndex !== index);
  }

  private isExpired(): boolean {
    if (!this.expiryDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.expiryDate < today;
  }

  private expiresSoon(): boolean {
    if (!this.expiryDate || this.isExpired()) return false;
    return this.expiryDate.getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000;
  }

  private toDateInputValue(value?: string): string {
    if (!value) return '';
    return value.slice(0, 10);
  }

  private parseDateInput(value?: string): Date | null {
    const raw = this.toDateInputValue(value);
    if (!raw) return null;
    const [year, month, day] = raw.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  private toDateOnlyString(value: Date | null): string {
    if (!value || Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
