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
import { DomainMonitor, DomainOwner, DomainPayload } from '../../services/domain-health.service';

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

  constructor(
    private dialogRef: MatDialogRef<DomainDialogComponent, DomainPayload>,
    @Inject(MAT_DIALOG_DATA) public data: { domain?: DomainMonitor }
  ) {
    this.model = {
      name: data.domain?.name || '',
      baseUrl: data.domain?.baseUrl || '',
      owner: data.domain?.owner || 'EPDS',
      enabled: data.domain?.enabled ?? true
    };
  }

  save(): void {
    if (!this.model.name.trim() || !this.model.baseUrl.trim() || !this.model.owner) return;
    this.dialogRef.close({
      name: this.model.name.trim(),
      baseUrl: this.model.baseUrl.trim(),
      owner: this.model.owner,
      enabled: this.model.enabled
    });
  }
}
