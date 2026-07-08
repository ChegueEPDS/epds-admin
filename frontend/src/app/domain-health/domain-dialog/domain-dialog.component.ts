import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DomainHealthConfig, DomainMonitor, DomainOwner, DomainPayload } from '../../services/domain-health.service';

@Component({
  selector: 'app-domain-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule
  ],
  templateUrl: './domain-dialog.component.html',
  styleUrl: './domain-dialog.component.scss'
})
export class DomainDialogComponent {
  owners: DomainOwner[] = ['Stahl', 'Robex', 'Veproil', 'ExNB/Exva', 'Ind-Ex', 'EPDS'];
  model: DomainPayload;
  readonly defaultHealthConfig: DomainHealthConfig = {
    checkPath: '',
    expectedStatusMin: 200,
    expectedStatusMax: 399,
    timeoutMs: 10000,
    warningResponseMs: 2500,
    errorResponseMs: 10000,
    followRedirects: true,
    tlsWarningDays: 30
  };

  constructor(
    private dialogRef: MatDialogRef<DomainDialogComponent, DomainPayload>,
    @Inject(MAT_DIALOG_DATA) public data: { domain?: DomainMonitor }
  ) {
    this.model = {
      name: data.domain?.name || '',
      baseUrl: data.domain?.baseUrl || '',
      owner: data.domain?.owner || 'EPDS',
      enabled: data.domain?.enabled ?? true,
      healthConfig: {
        ...this.defaultHealthConfig,
        ...(data.domain?.healthConfig || {})
      }
    };
  }

  save(): void {
    if (!this.model.name.trim() || !this.model.baseUrl.trim() || !this.model.owner) return;
    this.dialogRef.close({
      name: this.model.name.trim(),
      baseUrl: this.model.baseUrl.trim(),
      owner: this.model.owner,
      enabled: this.model.enabled,
      healthConfig: {
        checkPath: this.model.healthConfig.checkPath.trim(),
        expectedStatusMin: Number(this.model.healthConfig.expectedStatusMin),
        expectedStatusMax: Number(this.model.healthConfig.expectedStatusMax),
        timeoutMs: Number(this.model.healthConfig.timeoutMs),
        warningResponseMs: Number(this.model.healthConfig.warningResponseMs),
        errorResponseMs: Number(this.model.healthConfig.errorResponseMs),
        followRedirects: this.model.healthConfig.followRedirects,
        tlsWarningDays: Number(this.model.healthConfig.tlsWarningDays)
      }
    });
  }
}
