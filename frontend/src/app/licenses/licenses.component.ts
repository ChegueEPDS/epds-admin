import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RichTextEditorComponent } from '../shared/rich-text-editor/rich-text-editor.component';
import {
  AddressEnvironment,
  ContactArea,
  CurrencyCode,
  InfrastructureGroup,
  LicenseCustomer,
  LicensePayload,
  LicenseService,
  LicenseStatus,
  ObjectLimitOption
} from '../services/license.service';

type StatusFilter = 'all' | LicenseStatus | 'expired';
type LicenseDialogResult =
  | { action: 'save'; payload: LicensePayload }
  | { action: 'delete' };

const OBJECT_LIMIT_OPTIONS: ObjectLimitOption[] = ['1000', '6000', '11000', '16000', '21000', '26000', '31000', 'custom', 'unlimited'];
const CONTACT_AREAS: ContactArea[] = ['IT', 'Üzlet', 'Beszerzés'];
const ADDRESS_ENVIRONMENTS: AddressEnvironment[] = ['prod', 'test', 'dev'];
const CURRENCIES: CurrencyCode[] = ['HUF', 'EUR', 'USD'];

@Component({
  selector: 'app-license-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    RichTextEditorComponent
  ],
  template: `
    <div class="license-dialog-header">
      <div>
        <h2 mat-dialog-title>{{ data.license ? model.customerName : 'Add customer license' }}</h2>
        <p>{{ isEditing ? 'Editing license data' : 'Customer license sheet' }}</p>
      </div>
      <div class="dialog-header-actions">
        <button mat-stroked-button type="button" *ngIf="data.license && !isEditing" (click)="startEdit()">
          <mat-icon class="material-symbols-outlined">edit</mat-icon>
          Edit
        </button>
        <button mat-stroked-button color="warn" type="button" *ngIf="data.license && !isEditing" (click)="deleteFromSheet()">
          <mat-icon class="material-symbols-outlined">delete</mat-icon>
          Delete
        </button>
        <button mat-icon-button type="button" mat-dialog-close matTooltip="Close">
          <mat-icon class="material-symbols-outlined">close</mat-icon>
        </button>
      </div>
    </div>
    <form (ngSubmit)="save()">
      <mat-dialog-content class="license-dialog-content">
        <ng-container *ngIf="!isEditing; else editSheet">
          <section class="detail-hero" [ngClass]="statusClass()">
            <div>
              <span class="detail-eyebrow">EPDS license</span>
              <h3>{{ model.customerName }}</h3>
              <p>{{ statusText() }} · {{ objectLimitText() }} · expires {{ expiryDate | date:'mediumDate' }}</p>
            </div>
            <span class="detail-status">
              <mat-icon class="material-symbols-outlined">{{ statusIcon() }}</mat-icon>
              {{ statusText() }}
            </span>
          </section>

          <section class="detail-section">
            <h3>License</h3>
            <div class="detail-grid">
              <div>
                <span>Status</span>
                <strong>{{ statusText() }}</strong>
              </div>
              <div>
                <span>Object count</span>
                <strong>{{ objectLimitText() }}</strong>
              </div>
              <div>
                <span>Expiry date</span>
                <strong>{{ expiryDate | date:'mediumDate' }}</strong>
              </div>
              <div>
                <span>Mobile app</span>
                <strong>{{ model.mobileApp ? 'Yes' : 'No' }}</strong>
              </div>
            </div>
          </section>

          <section class="detail-section">
            <h3>Commercial</h3>
            <div class="detail-grid">
              <div>
                <span>License price</span>
                <strong>{{ priceText(model.licensePrice, model.licenseCurrency) }}</strong>
              </div>
              <div>
                <span>Support price</span>
                <strong>{{ priceText(model.supportPrice, model.supportCurrency) }}</strong>
              </div>
            </div>
          </section>

          <section class="detail-section">
            <h3>Contacts</h3>
            <div class="contact-card-grid" *ngIf="model.contacts.length; else noContacts">
              <div class="contact-card" *ngFor="let contact of model.contacts">
                <div class="contact-card-head">
                  <strong>{{ emptyText(contact.name) }}</strong>
                  <span class="contact-area-badge" [ngClass]="contactAreaClass(contact.area)">
                    {{ contact.area || 'N/A' }}
                  </span>
                </div>
                <div class="contact-line">
                  <mat-icon class="material-symbols-outlined">mail</mat-icon>
                  <span>{{ emptyText(contact.email) }}</span>
                </div>
                <div class="contact-line">
                  <mat-icon class="material-symbols-outlined">call</mat-icon>
                  <span>{{ phoneText(contact.phone) }}</span>
                </div>
              </div>
            </div>
            <ng-template #noContacts>
              <div class="notes-empty">No contacts.</div>
            </ng-template>
          </section>

          <section class="detail-section">
            <h3>Infrastructure</h3>
            <div class="infrastructure-card-grid" *ngIf="model.infrastructureGroups.length; else noInfrastructureGroups">
              <div class="infrastructure-card" *ngFor="let group of model.infrastructureGroups">
                <div class="infrastructure-card-head">
                  <span class="environment-badge" [ngClass]="environmentClass(group.environment)">
                    {{ environmentLabel(group.environment) }}
                  </span>
                </div>
                <div class="infrastructure-lines">
                  <div>
                    <span>Application server</span>
                    <strong>{{ emptyText(group.applicationServerAddress) }}</strong>
                  </div>
                  <div>
                    <span>Database server</span>
                    <strong>{{ emptyText(group.databaseServerAddress) }}</strong>
                  </div>
                  <div>
                    <span>Application address</span>
                    <strong>{{ emptyText(group.applicationAddress) }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <ng-template #noInfrastructureGroups>
              <div class="notes-empty">No infrastructure groups.</div>
            </ng-template>
          </section>

          <section class="detail-section">
            <h3>Remote Access</h3>
            <div class="detail-grid">
              <div>
                <span>VPN app</span>
                <strong>{{ emptyText(model.vpnApp) }}</strong>
              </div>
              <div>
                <span>VPN app address</span>
                <strong>{{ emptyText(model.accessAddresses[0]?.address) }}</strong>
              </div>
              <div>
                <span>2FA app</span>
                <strong>{{ emptyText(model.twoFactorApp) }}</strong>
              </div>
            </div>
            <div class="mini-table" *ngIf="model.vpnCredentials.length; else noVpnCredentials">
              <div class="mini-table-head two-col">
                <span>VPN login name</span>
                <span>Password</span>
              </div>
              <div class="mini-table-row two-col" *ngFor="let credential of model.vpnCredentials; let i = index">
                <strong>{{ emptyText(credential.username) }}</strong>
                <span class="password-cell">
                  <span>{{ isVpnPasswordVisible(i) ? emptyText(credential.password) : maskedPassword(credential.password) }}</span>
                  <button mat-icon-button type="button" [matTooltip]="isVpnPasswordVisible(i) ? 'Hide password' : 'Show password'" (click)="toggleVpnPassword(i)">
                    <mat-icon class="material-symbols-outlined">{{ isVpnPasswordVisible(i) ? 'visibility_off' : 'visibility' }}</mat-icon>
                  </button>
                </span>
              </div>
            </div>
            <ng-template #noVpnCredentials>
              <div class="notes-empty">No VPN logins.</div>
            </ng-template>
          </section>

          <section class="detail-section">
            <h3>Notes</h3>
            <div class="notes-readonly" *ngIf="model.notesHtml; else noNotes" [innerHTML]="model.notesHtml"></div>
            <ng-template #noNotes>
              <div class="notes-empty">No notes.</div>
            </ng-template>
          </section>
        </ng-container>

        <ng-template #editSheet>
        <section class="dialog-section">
          <h3>License</h3>
          <div class="dialog-grid">
            <mat-form-field appearance="outline">
              <mat-label>Customer</mat-label>
              <input matInput name="customerName" [(ngModel)]="model.customerName" required>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Status</mat-label>
              <mat-select name="status" [(ngModel)]="model.status" required>
                <mat-option value="active">Active</mat-option>
                <mat-option value="inactive">Inactive</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Object count</mat-label>
              <mat-select name="objectLimitOption" [(ngModel)]="model.objectLimitOption" required>
                <mat-option *ngFor="let option of objectLimitOptions" [value]="option">{{ objectLimitLabel(option) }}</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" *ngIf="model.objectLimitOption === 'custom'">
              <mat-label>Custom object count</mat-label>
              <input matInput type="number" min="1" step="1" name="customObjectLimit" [(ngModel)]="model.customObjectLimit" required>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Expiry date</mat-label>
              <input matInput [matDatepicker]="expiresAtPicker" name="expiresAt" [(ngModel)]="expiryDate" required>
              <mat-datepicker-toggle matIconSuffix [for]="expiresAtPicker"></mat-datepicker-toggle>
              <mat-datepicker #expiresAtPicker></mat-datepicker>
            </mat-form-field>

            <mat-checkbox name="mobileApp" [(ngModel)]="model.mobileApp">Mobile app</mat-checkbox>
          </div>
        </section>

        <section class="dialog-section">
          <h3>Commercial</h3>
          <div class="dialog-grid">
            <mat-form-field appearance="outline">
              <mat-label>License price</mat-label>
              <input matInput type="number" min="0" step="1" name="licensePrice" [(ngModel)]="model.licensePrice">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>License currency</mat-label>
              <mat-select name="licenseCurrency" [(ngModel)]="model.licenseCurrency">
                <mat-option *ngFor="let currency of currencies" [value]="currency">{{ currencyLabel(currency) }}</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Support price</mat-label>
              <input matInput type="number" min="0" step="1" name="supportPrice" [(ngModel)]="model.supportPrice">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Support currency</mat-label>
              <mat-select name="supportCurrency" [(ngModel)]="model.supportCurrency">
                <mat-option *ngFor="let currency of currencies" [value]="currency">{{ currencyLabel(currency) }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </section>

        <section class="dialog-section">
          <div class="section-head">
            <h3>Contacts</h3>
            <button mat-stroked-button type="button" (click)="addContact()">
              <mat-icon class="material-symbols-outlined">add</mat-icon>
              Add more
            </button>
          </div>
          <div class="repeater-list" *ngIf="model.contacts.length; else emptyContactsEdit">
            <div class="repeater-row contact-row" *ngFor="let contact of model.contacts; let i = index">
              <mat-form-field appearance="outline">
                <mat-label>Name</mat-label>
                <input matInput [name]="'contactName' + i" [(ngModel)]="contact.name">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>E-mail</mat-label>
                <input matInput type="email" [name]="'contactEmail' + i" [(ngModel)]="contact.email">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Phone</mat-label>
                <input matInput type="tel" autocomplete="tel" inputmode="tel" [name]="'contactPhone' + i" [(ngModel)]="contact.phone">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Type</mat-label>
                <mat-select [name]="'contactArea' + i" [(ngModel)]="contact.area">
                  <mat-option [value]="null">Not set</mat-option>
                  <mat-option *ngFor="let area of contactAreas" [value]="area">{{ area }}</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-icon-button type="button" matTooltip="Remove contact" (click)="removeContact(i)">
                <mat-icon class="material-symbols-outlined">delete</mat-icon>
              </button>
            </div>
          </div>
          <ng-template #emptyContactsEdit>
            <div class="notes-empty">No contacts added.</div>
          </ng-template>
        </section>

        <section class="dialog-section">
          <div class="section-head">
            <h3>Infrastructure</h3>
            <button mat-stroked-button type="button" (click)="addInfrastructureGroup()">
              <mat-icon class="material-symbols-outlined">add</mat-icon>
              Add group
            </button>
          </div>
          <div class="repeater-list" *ngIf="model.infrastructureGroups.length; else emptyInfrastructureGroupsEdit">
            <div class="repeater-row infrastructure-group-row" *ngFor="let group of model.infrastructureGroups; let i = index">
              <mat-form-field appearance="outline">
                <mat-label>Type</mat-label>
                <mat-select [name]="'infrastructureEnvironment' + i" [(ngModel)]="group.environment">
                  <mat-option *ngFor="let environment of addressEnvironments" [value]="environment">{{ environmentLabel(environment) }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Application server</mat-label>
                <input matInput [name]="'infrastructureApplicationServer' + i" [(ngModel)]="group.applicationServerAddress">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Database server</mat-label>
                <input matInput [name]="'infrastructureDatabaseServer' + i" [(ngModel)]="group.databaseServerAddress">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Application address</mat-label>
                <input matInput [name]="'infrastructureApplicationAddress' + i" [(ngModel)]="group.applicationAddress">
              </mat-form-field>
              <button mat-icon-button type="button" matTooltip="Remove infrastructure group" (click)="removeInfrastructureGroup(i)">
                <mat-icon class="material-symbols-outlined">delete</mat-icon>
              </button>
            </div>
          </div>
          <ng-template #emptyInfrastructureGroupsEdit>
            <div class="notes-empty">No infrastructure groups added.</div>
          </ng-template>
        </section>

        <section class="dialog-section">
          <h3>Remote Access</h3>
          <div class="dialog-grid">
            <mat-form-field appearance="outline">
              <mat-label>VPN app</mat-label>
              <input matInput name="vpnApp" [(ngModel)]="model.vpnApp">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>VPN app address</mat-label>
              <input matInput name="vpnAppAddress" [(ngModel)]="model.accessAddresses[0].address">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>2FA app</mat-label>
              <input matInput name="twoFactorApp" [(ngModel)]="model.twoFactorApp">
            </mat-form-field>
          </div>

          <div class="section-head">
            <h3>VPN logins</h3>
            <button mat-stroked-button type="button" (click)="addVpnCredential()">
              <mat-icon class="material-symbols-outlined">add</mat-icon>
              Add login
            </button>
          </div>
          <div class="repeater-list" *ngIf="model.vpnCredentials.length; else emptyVpnEdit">
            <div class="repeater-row vpn-row" *ngFor="let credential of model.vpnCredentials; let i = index">
              <mat-form-field appearance="outline">
                <mat-label>VPN login name</mat-label>
                <input matInput [name]="'vpnUsername' + i" [(ngModel)]="credential.username">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Password</mat-label>
                <input matInput [type]="isVpnPasswordVisible(i) ? 'text' : 'password'" autocomplete="new-password" [name]="'vpnPassword' + i" [(ngModel)]="credential.password">
                <button mat-icon-button matSuffix type="button" [matTooltip]="isVpnPasswordVisible(i) ? 'Hide password' : 'Show password'" (click)="toggleVpnPassword(i)">
                  <mat-icon class="material-symbols-outlined">{{ isVpnPasswordVisible(i) ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
              <button mat-icon-button type="button" matTooltip="Remove login" (click)="removeVpnCredential(i)">
                <mat-icon class="material-symbols-outlined">delete</mat-icon>
              </button>
            </div>
          </div>
          <ng-template #emptyVpnEdit>
            <div class="notes-empty">No VPN logins added.</div>
          </ng-template>
        </section>

        <section class="dialog-section">
          <h3>Notes</h3>
          <app-rich-text-editor
            class="body-field"
            ariaLabel="License notes"
            placeholder="Write notes..."
            minHeight="180px"
            [(html)]="model.notesHtml"
          ></app-rich-text-editor>
        </section>
        </ng-template>
      </mat-dialog-content>
      <mat-dialog-actions align="end" *ngIf="isEditing">
        <button mat-button type="button" (click)="cancelEdit()">{{ data.license ? 'Cancel edit' : 'Cancel' }}</button>
        <button mat-flat-button color="primary" type="submit">
          <mat-icon class="material-symbols-outlined">save</mat-icon>
          Save
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [`
    .license-dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px 10px;
      border-bottom: 1px solid var(--brand-border);
    }
    .license-dialog-header h2 {
      margin: 0;
      padding: 0;
      font-size: 22px;
      line-height: 1.2;
    }
    .license-dialog-header p {
      margin: 4px 0 0;
      color: var(--brand-muted);
      font-size: 13px;
    }
    .dialog-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .dialog-header-actions button mat-icon {
      margin-right: 6px;
    }
    .license-dialog-content {
      display: grid;
      width: min(920px, calc(100vw - 48px));
      max-height: calc(92vh - 112px);
      gap: 18px;
      padding-top: 18px;
    }
    .detail-hero {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      padding: 18px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #f8fafc;
    }
    .detail-hero h3 {
      margin: 4px 0;
      font-size: 24px;
      line-height: 1.15;
    }
    .detail-hero p {
      margin: 0;
      color: var(--brand-muted);
    }
    .detail-eyebrow {
      color: #92400e;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .detail-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: max-content;
      font-weight: 800;
    }
    .detail-status mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .detail-hero.status-active .detail-status {
      color: #047857;
    }
    .detail-hero.status-warning .detail-status {
      color: #b45309;
    }
    .detail-hero.status-expired .detail-status {
      color: #b91c1c;
    }
    .detail-hero.status-inactive .detail-status {
      color: #4b5563;
    }
    .detail-section {
      display: grid;
      gap: 10px;
    }
    .detail-section h3 {
      margin: 0;
      color: #111827;
      font-size: 15px;
      line-height: 1.2;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .detail-grid div,
    .notes-readonly,
    .notes-empty {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #fff;
    }
    .detail-grid span {
      display: block;
      margin-bottom: 4px;
      color: var(--brand-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .detail-grid strong {
      display: block;
      min-width: 0;
      color: #111827;
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .infrastructure-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }
    .infrastructure-card {
      display: grid;
      gap: 10px;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .infrastructure-card-head {
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    .environment-badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 9px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.2;
      text-transform: uppercase;
    }
    .environment-prod {
      color: #047857;
      background: #d1fae5;
      border-color: #a7f3d0;
    }
    .environment-test {
      color: #1d4ed8;
      background: #dbeafe;
      border-color: #bfdbfe;
    }
    .environment-dev {
      color: #92400e;
      background: #fef3c7;
      border-color: #fde68a;
    }
    .infrastructure-lines {
      display: grid;
      gap: 8px;
    }
    .infrastructure-lines div {
      min-width: 0;
    }
    .infrastructure-lines span {
      display: block;
      margin-bottom: 3px;
      color: var(--brand-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .infrastructure-lines strong {
      display: block;
      min-width: 0;
      color: #111827;
      font-size: 13px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .notes-readonly {
      min-height: 120px;
      line-height: 1.45;
    }
    .notes-empty {
      color: var(--brand-muted);
      min-height: 72px;
    }
    .mini-table {
      display: grid;
      overflow: hidden;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #fff;
    }
    .mini-table-head,
    .mini-table-row {
      display: grid;
      grid-template-columns: 1.15fr 1.3fr 1fr 0.8fr;
      gap: 10px;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--brand-border);
      min-width: 0;
    }
    .mini-table-head.two-col,
    .mini-table-row.two-col {
      grid-template-columns: 1fr 1fr;
    }
    .mini-table-head.three-col,
    .mini-table-row.three-col {
      grid-template-columns: 1.5fr 0.8fr 0.9fr;
    }
    .mini-table-row:last-child {
      border-bottom: 0;
    }
    .mini-table-head {
      color: var(--brand-muted);
      background: #f8fafc;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .mini-table-row strong,
    .mini-table-row span {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
    }
    .password-cell {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .password-cell > span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .password-cell .mat-mdc-icon-button {
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      padding: 4px;
    }
    .password-cell mat-icon {
      margin: 0;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .contact-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
    }
    .contact-card {
      display: grid;
      gap: 10px;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .contact-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .contact-card-head strong {
      min-width: 0;
      color: #111827;
      font-size: 14px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .contact-area-badge {
      flex: 0 0 auto;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.2;
      text-transform: uppercase;
      border: 1px solid transparent;
    }
    .contact-area-it {
      color: #1d4ed8;
      background: #dbeafe;
      border-color: #bfdbfe;
    }
    .contact-area-business {
      color: #047857;
      background: #d1fae5;
      border-color: #a7f3d0;
    }
    .contact-area-procurement {
      color: #92400e;
      background: #fef3c7;
      border-color: #fde68a;
    }
    .contact-area-empty {
      color: #4b5563;
      background: #f3f4f6;
      border-color: #e5e7eb;
    }
    .contact-line {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      min-width: 0;
      color: #374151;
      font-size: 13px;
    }
    .contact-line mat-icon {
      margin: 0;
      width: 18px;
      height: 18px;
      color: var(--brand-muted);
      font-size: 18px;
    }
    .contact-line span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .dialog-section {
      display: grid;
      gap: 10px;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .section-head h3 {
      margin: 0;
    }
    .section-head button mat-icon {
      margin-right: 6px;
    }
    .dialog-section h3 {
      margin: 0;
      color: #111827;
      font-size: 15px;
      line-height: 1.2;
    }
    .dialog-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .group-controls {
      display: grid;
      grid-template-columns: minmax(180px, 0.6fr) minmax(180px, 0.6fr);
      gap: 12px;
      align-items: start;
      width: min(520px, 100%);
    }
    .group-controls.single-control {
      grid-template-columns: minmax(180px, 0.5fr);
    }
    .wide-field {
      grid-column: 1 / -1;
    }
    mat-checkbox {
      align-self: center;
      min-height: 48px;
      display: flex;
      align-items: center;
    }
    .repeater-list {
      display: grid;
      gap: 10px;
    }
    .repeater-row {
      display: grid;
      align-items: start;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #fff;
    }
    .contact-row {
      grid-template-columns: 1.1fr 1.2fr 1fr 0.8fr auto;
    }
    .infrastructure-group-row {
      grid-template-columns: 0.7fr 1.2fr 1.2fr 1.2fr auto;
    }
    .vpn-row {
      grid-template-columns: 1fr 1fr auto;
    }
    .repeater-row .mat-mdc-icon-button {
      margin-top: 7px;
    }
    button mat-icon {
      margin-right: 6px;
    }
    @media (max-width: 760px) {
      .dialog-grid,
      .group-controls,
      .group-controls.single-control,
      .contact-row,
      .infrastructure-group-row,
      .vpn-row,
      .mini-table-head,
      .mini-table-row,
      .mini-table-head.two-col,
      .mini-table-row.two-col,
      .mini-table-head.three-col,
      .mini-table-row.three-col {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class LicenseDialogComponent {
  objectLimitOptions = OBJECT_LIMIT_OPTIONS;
  contactAreas = CONTACT_AREAS;
  addressEnvironments = ADDRESS_ENVIRONMENTS;
  currencies = CURRENCIES;
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
    return Number(option).toLocaleString('hu-HU');
  }

  objectLimitText(): string {
    if (this.model.objectLimitOption === 'unlimited') return 'Unlimited';
    const value = this.model.objectLimitOption === 'custom' ? this.model.customObjectLimit : Number(this.model.objectLimitOption);
    return `${Number(value || 0).toLocaleString('hu-HU')} objects`;
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
        databaseServerAddress: group.databaseServerAddress || '',
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
        databaseServerAddress: '',
        applicationAddress: ''
      };
      groups.set(key, group);
      return group;
    };

    if (license?.applicationServerAddress) {
      ensureGroup('prod').applicationServerAddress = license.applicationServerAddress;
    }
    for (const item of license?.databaseAddresses || []) {
      const group = ensureGroup(item.environment);
      if (!group.databaseServerAddress) group.databaseServerAddress = item.address || '';
    }
    for (const item of license?.applicationAddresses || []) {
      const group = ensureGroup(item.environment);
      if (!group.applicationAddress) group.applicationAddress = item.address || '';
    }
    if (!license?.applicationAddresses?.length && license?.applicationAddress) {
      ensureGroup('prod').applicationAddress = license.applicationAddress;
    }

    return Array.from(groups.values()).filter((group) => (
      group.applicationServerAddress || group.databaseServerAddress || group.applicationAddress
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
        databaseServerAddress: String(group.databaseServerAddress || '').trim(),
        applicationAddress: String(group.applicationAddress || '').trim()
      }))
      .filter((group) => group.applicationServerAddress || group.databaseServerAddress || group.applicationAddress);
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
            databaseType: null
          }))
          .filter((item) => item.address),
        databaseServerAddress: infrastructureGroups[0]?.databaseServerAddress || '',
        databaseServerType: null,
        applicationServerAddress: infrastructureGroups[0]?.applicationServerAddress || '',
        applicationServerType: this.model.applicationServerType || null,
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
        databaseServerAddress: '',
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

@Component({
  selector: 'app-licenses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  templateUrl: './licenses.component.html',
  styleUrl: './licenses.component.scss'
})
export class LicensesComponent implements OnInit {
  licenses: LicenseCustomer[] = [];
  searchTerm = '';
  statusFilter: StatusFilter = 'all';
  isLoading = false;

  constructor(
    private licenseService: LicenseService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadLicenses();
  }

  get filteredLicenses(): LicenseCustomer[] {
    const search = this.searchTerm.trim().toLowerCase();
    return this.licenses.filter((license) => {
      const matchesSearch = !search || license.customerName.toLowerCase().includes(search);
      const matchesStatus = this.statusFilter === 'all'
        || license.status === this.statusFilter
        || (this.statusFilter === 'expired' && this.isExpired(license));
      return matchesSearch && matchesStatus;
    });
  }

  async loadLicenses(): Promise<void> {
    this.isLoading = true;
    try {
      const response = await firstValueFrom(this.licenseService.listLicenses());
      this.licenses = response.licenses;
    } catch (err) {
      this.showError('Could not load licenses');
    } finally {
      this.isLoading = false;
    }
  }

  async openLicenseDialog(license?: LicenseCustomer): Promise<void> {
    const ref = this.dialog.open(LicenseDialogComponent, {
      width: '960px',
      maxWidth: 'calc(100vw - 32px)',
      data: { license }
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;

    try {
      if (result.action === 'delete') {
        if (!license) return;
        await this.deleteLicense(license);
        return;
      }

      if (license) {
        const response = await firstValueFrom(this.licenseService.updateLicense(license.id, result.payload));
        this.licenses = this.licenses.map((item) => item.id === license.id ? response.license : item);
        this.snackBar.open('License updated', 'Close', { duration: 2500 });
      } else {
        const response = await firstValueFrom(this.licenseService.createLicense(result.payload));
        this.licenses = [...this.licenses, response.license].sort((a, b) => a.customerName.localeCompare(b.customerName));
        this.snackBar.open('License created', 'Close', { duration: 2500 });
      }
    } catch (err: any) {
      this.showError(err?.error?.error || 'Could not save license');
    }
  }

  async deleteLicense(license: LicenseCustomer): Promise<void> {
    if (!confirm(`Delete license for ${license.customerName}?`)) return;
    try {
      await firstValueFrom(this.licenseService.deleteLicense(license.id));
      this.licenses = this.licenses.filter((item) => item.id !== license.id);
      this.snackBar.open('License deleted', 'Close', { duration: 2500 });
    } catch {
      this.showError('Could not delete license');
    }
  }

  trackByLicense(index: number, license: LicenseCustomer): string {
    return license.id;
  }

  summary(status: StatusFilter): number {
    if (status === 'all') return this.licenses.length;
    if (status === 'expired') return this.licenses.filter((license) => this.isExpired(license)).length;
    return this.licenses.filter((license) => license.status === status).length;
  }

  isExpired(license: LicenseCustomer): boolean {
    const expiresAt = new Date(license.expiresAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiresAt < today;
  }

  expiresSoon(license: LicenseCustomer): boolean {
    if (this.isExpired(license)) return false;
    const expiresAt = new Date(license.expiresAt).getTime();
    const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return expiresAt <= soon;
  }

  statusIcon(license: LicenseCustomer): string {
    if (license.status === 'inactive') return 'pause_circle';
    if (this.isExpired(license)) return 'event_busy';
    if (this.expiresSoon(license)) return 'warning';
    return 'check_circle';
  }

  statusLabel(license: LicenseCustomer): string {
    if (license.status === 'inactive') return 'Inactive';
    if (this.isExpired(license)) return 'Expired';
    if (this.expiresSoon(license)) return 'Expires soon';
    return 'Active';
  }

  rowStatusClass(license: LicenseCustomer): string {
    if (license.status === 'inactive') return 'status-inactive';
    if (this.isExpired(license)) return 'status-expired';
    if (this.expiresSoon(license)) return 'status-warning';
    return 'status-active';
  }

  objectLimitText(license: LicenseCustomer): string {
    if (license.objectLimitOption === 'unlimited') return 'Unlimited';
    const value = license.objectLimitOption === 'custom' ? license.customObjectLimit : Number(license.objectLimitOption);
    return `${Number(value || 0).toLocaleString('hu-HU')} objects`;
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3500 });
  }
}
