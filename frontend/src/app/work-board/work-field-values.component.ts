import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { displayWorkField, isWorkFieldFile, WorkField, WorkFieldAmount, WorkFieldFiles, WorkFieldOption, WorkFieldValue, WorkFieldValues } from './work-fields';

@Component({
  selector: 'app-work-field-values',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './work-field-values.component.html',
  styles: [`
    .fields { display: grid; gap: 10px 14px; margin-top: 12px;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
    .wide { grid-column: 1 / -1; }
    .item { display: grid; gap: 5px; min-width: 0; overflow-wrap: anywhere; }
    small { color: var(--brand-muted); }
    .link { align-self: start; justify-self: start; padding: 0; background: none; border: 0;
      color: var(--brand-accent-ink); font: inherit; text-align: left; text-decoration: underline; cursor: pointer; }
    .file input { max-width: 100%; font: inherit; }
    .amount { display: grid; gap: 8px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  `]
})
export class WorkFieldValuesComponent {
  @Input({ required: true }) fields: WorkField[] = [];
  @Input() values: WorkFieldValues = {};
  @Input() changes?: WorkFieldValues;
  @Input() files?: WorkFieldFiles;
  @Input() currency = 'HUF';
  @Output() download = new EventEmitter<WorkField>();
  readonly standalone = { standalone: true };
  readonly isFile = isWorkFieldFile;
  readonly display = displayWorkField;

  value(field: WorkField): WorkFieldValue | null {
    return this.changes && Object.hasOwn(this.changes, field.id) ? this.changes[field.id] : this.values[field.id] ?? null;
  }

  set(field: WorkField, value: WorkFieldValue): void {
    if (this.changes) this.changes[field.id] = value === '' ? null : value;
  }

  options(field: WorkField): WorkFieldOption[] {
    const current = this.value(field);
    const selected = Array.isArray(current) ? current : [current];
    return field.options.filter((option) => !option.archived || selected.includes(option.id));
  }

  amount(field: WorkField): Partial<WorkFieldAmount> {
    const value = this.value(field);
    return value && typeof value === 'object' && 'amount' in value ? value : { currency: this.currency };
  }

  setAmount(field: WorkField, amount: number | null): void {
    this.set(field, amount === null ? null : { amount, currency: this.amount(field).currency || this.currency });
  }

  setCurrency(field: WorkField, currency: string): void {
    const amount = this.amount(field).amount;
    if (amount !== undefined) this.set(field, { amount, currency: currency.trim().toUpperCase() });
  }

  chooseFile(field: WorkField, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (this.files && this.changes && file) {
      this.files[field.id] = file;
      delete this.changes[field.id];
    }
    input.value = '';
  }

  removeFile(field: WorkField): void {
    if (this.files) delete this.files[field.id];
    this.set(field, null);
  }
}
