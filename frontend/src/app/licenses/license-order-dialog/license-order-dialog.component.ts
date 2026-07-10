import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { LicenseCustomer, LicenseOrderPayload, ObjectLimitOption } from '../../services/license.service';

const OBJECT_LIMIT_OPTIONS: ObjectLimitOption[] = ['1000', '6000', '11000', '16000', '21000', '26000', '31000', 'custom', 'unlimited'];

@Component({
  selector: 'app-license-order-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule
  ],
  templateUrl: './license-order-dialog.component.html',
  styleUrl: './license-order-dialog.component.scss'
})
export class LicenseOrderDialogComponent {
  objectLimitOptions = OBJECT_LIMIT_OPTIONS;
  model: LicenseOrderPayload;
  expiryDate: Date | null;

  constructor(
    private dialogRef: MatDialogRef<LicenseOrderDialogComponent, LicenseOrderPayload>,
    @Inject(MAT_DIALOG_DATA) public data: { license: LicenseCustomer }
  ) {
    const currentExpiry = this.parseDate(data.license.expiresAt) || new Date();
    const nextExpiry = new Date(currentExpiry);
    nextExpiry.setFullYear(nextExpiry.getFullYear() + 1);
    this.expiryDate = nextExpiry;
    this.model = {
      objectLimitOption: data.license.objectLimitOption,
      customObjectLimit: data.license.customObjectLimit,
      mobileApp: data.license.mobileApp,
      expiresAt: this.toDateOnlyString(nextExpiry)
    };
  }

  objectLimitLabel(option: ObjectLimitOption): string {
    if (option === 'custom') return 'Custom';
    if (option === 'unlimited') return 'Unlimited';
    return this.formatObjectCount(option);
  }

  save(): void {
    const customObjectLimit = Number(this.model.customObjectLimit);
    const expiresAt = this.toDateOnlyString(this.expiryDate);
    if (!expiresAt) return;
    if (this.model.objectLimitOption === 'custom' && (!Number.isInteger(customObjectLimit) || customObjectLimit < 1)) return;
    this.dialogRef.close({
      objectLimitOption: this.model.objectLimitOption,
      customObjectLimit: this.model.objectLimitOption === 'custom' ? customObjectLimit : null,
      mobileApp: this.model.mobileApp === true,
      expiresAt
    });
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toDateOnlyString(value: Date | null): string {
    if (!value) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatObjectCount(value: number | string | null | undefined): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    return String(Math.trunc(numericValue)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
}
