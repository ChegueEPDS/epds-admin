import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogEntry, Custom, Field, Value } from './project-tracker.service';

@Component({
  selector: 'app-tracker-field-inputs',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fields">
      @for (field of fields; track field.id) {
        @if (editable) {
          <label>{{ field.label }} @if (field.required) { <span aria-label="required">*</span> }
            @switch (field.type) {
              @case ('longText') { <textarea [ngModel]="values[field.id] || ''" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone" rows="3"></textarea> }
              @case ('number') { <input type="number" [ngModel]="values[field.id] ?? null" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone"> }
              @case ('date') { <input type="date" [ngModel]="values[field.id] || ''" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone"> }
              @case ('boolean') {
                <select [ngModel]="values[field.id] ?? null" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone">
                  <option [ngValue]="null">Unspecified</option><option [ngValue]="true">Yes</option><option [ngValue]="false">No</option>
                </select>
              }
              @case ('multiSelect') {
                <select multiple [ngModel]="values[field.id] || []" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone">
                  @for (option of field.options; track option.id) {
                    @if (!option.archived || selected(field.id, option.id)) { <option [ngValue]="option.id">{{ option.name }}</option> }
                  }
                </select>
              }
              @case ('select') {
                <select [ngModel]="values[field.id] || ''" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone">
                  <option value="">Unspecified</option>
                  @for (option of field.options; track option.id) {
                    @if (!option.archived || values[field.id] === option.id) { <option [ngValue]="option.id">{{ option.name }}</option> }
                  }
                </select>
              }
              @case ('user') {
                <select [ngModel]="values[field.id] || ''" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone">
                  <option value="">Unassigned</option>
                  @for (user of users; track user.id) { <option [ngValue]="user.id">{{ user.name }}</option> }
                </select>
              }
              @default { <input [type]="field.type === 'url' ? 'url' : 'text'" [ngModel]="values[field.id] || ''" (ngModelChange)="set(field.id, $event)" [ngModelOptions]="standalone"> }
            }
          </label>
        } @else {
          <div class="field-value"><small>{{ field.label }}</small>
            @if (field.type === 'url' && values[field.id]) { <a [href]="values[field.id]" target="_blank" rel="noopener noreferrer">{{ values[field.id] }}</a> }
            @else { <span>{{ displayField(field, values[field.id], users) || '—' }}</span> }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .fields { display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:12px }
    label,.field-value { display:grid;gap:4px;align-content:start;font-size:.9rem;overflow-wrap:anywhere }
    small { opacity:.75 }
    input,select,textarea { box-sizing:border-box;width:100%;min-height:36px;border:1px solid #94a3b8;border-radius:6px;padding:6px 8px;background:inherit;color:inherit;font:inherit }
  `]
})
export class TrackerFieldInputsComponent {
  @Input() fields: Field[] = [];
  @Input() values: Custom = {};
  @Input() changes?: Custom;
  @Input() users: CatalogEntry[] = [];
  @Input() editable = false;
  readonly standalone = { standalone: true };
  readonly displayField = displayField;

  set(id: string, value: Value): void {
    this.values[id] = value;
    if (this.changes) this.changes[id] = value;
  }

  selected(id: string, option: string): boolean {
    const value = this.values[id];
    return Array.isArray(value) && value.includes(option);
  }
}

export function displayField(field: Field, value: Value | undefined, users: CatalogEntry[]): string {
  if (value == null) return '';
  const label = (id: string) => field.options.find((item) => item.id === id)?.name || id;
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'user') return users.find((user) => user.id === value)?.name || String(value);
  if (field.type === 'select') return label(String(value));
  if (Array.isArray(value)) return value.map(label).join(', ');
  return String(value);
}
