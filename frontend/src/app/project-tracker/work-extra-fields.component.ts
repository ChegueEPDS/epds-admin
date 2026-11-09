import { Component, inject, Input, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BoardSettings, Custom, FieldTarget, ProjectTrackerService, RecordData, WorkFields } from './project-tracker.service';
import { TrackerFieldInputsComponent } from './tracker-field-inputs.component';
import { errorText } from './project-tracker-settings.component';

@Component({
  selector: 'app-work-extra-fields',
  imports: [FormsModule, TrackerFieldInputsComponent],
  template: `
    @if (visible) {
      <section class="tenant-fields" [attr.aria-label]="title">
        <strong>{{ title }}</strong>
        @if (kind === 'work' && settings?.data?.units?.length) {
          @if (editable) {
            <label>Business unit <select [(ngModel)]="unitId" [ngModelOptions]="{standalone:true}">
              <option value="">Unassigned</option>
              @for (unit of settings?.data?.units || []; track unit.id) {
                @if (!unit.archived || unit.id === unitId) { <option [value]="unit.id">{{ unit.name }}</option> }
              }
            </select></label>
          } @else { <span>Business unit · {{ unitName || 'Unassigned' }}</span> }
        }
        <app-tracker-field-inputs [fields]="fields" [values]="values" [changes]="changes" [users]="settings?.users || []" [editable]="editable"/>
        @if (editable) { <button type="button" (click)="save()" [disabled]="busy || !record">Save tenant fields</button> }
        @if (error) { <small class="error" role="alert">{{ error }}</small> }
        @if (saved) { <small role="status">Tenant fields saved.</small> }
      </section>
    }
  `,
  styles: [`
    .tenant-fields { display:grid;gap:8px;padding:12px;border:1px solid #d7e1ec;border-radius:8px;margin:8px 0;overflow-wrap:anywhere }
    select,button { border:1px solid #94a3b8;border-radius:6px;background:inherit;color:inherit;padding:6px 8px;font:inherit }
    label { display:flex;gap:8px;align-items:center } button { justify-self:start;cursor:pointer }
    .error { color:#9d2222 }
  `]
})
export class WorkExtraFieldsComponent implements OnChanges {
  private readonly api = inject(ProjectTrackerService);
  @Input() kind: FieldTarget = 'work';
  @Input() id = '';
  @Input() location = 'boardDetails';
  @Input() editable = false;
  @Input() settings?: BoardSettings;
  record?: RecordData<WorkFields>;
  values: Custom = {};
  changes: Custom = {};
  unitId = '';
  busy = false;
  error = '';
  saved = false;
  request = 0;
  get title(): string { return this.kind === 'work' ? 'Work settings' : 'Tenant fields'; }
  get fields() { return (this.settings?.data.fields || []).filter((field) => field.target === this.kind && !field.archived && field.locations.includes(this.location)); }
  get visible(): boolean { return Boolean(this.id && (this.fields.length || (this.kind === 'work' && this.settings?.data.units.length))); }
  get unitName(): string { return this.settings?.data.units.find((unit) => unit.id === this.unitId)?.name || ''; }

  ngOnChanges(): void {
    const request = ++this.request;
    this.record = undefined; this.error = ''; this.saved = false;
    if (!this.visible) return;
    void firstValueFrom(this.api.boardFields(this.kind, this.id)).then((record) => {
      if (request === this.request) this.setRecord(record);
    }).catch((error) => { if (request === this.request) this.error = errorText(error); });
  }

  setRecord(record: RecordData<WorkFields>): void {
    this.record = record;
    this.unitId = record.data.unitId;
    this.values = { ...record.data.custom };
    this.changes = {};
  }

  async save(): Promise<void> {
    if (!this.record || this.busy) return;
    const request = this.request;
    this.busy = true; this.error = ''; this.saved = false;
    try {
      const result = await firstValueFrom(this.api.saveBoardFields(this.kind, this.id, this.record.version,
        { custom: this.changes, ...(this.kind === 'work' ? { unitId: this.unitId } : {}) }));
      if (request === this.request) { this.setRecord(result); this.saved = true; }
    } catch (error) { if (request === this.request) this.error = errorText(error); }
    finally { this.busy = false; }
  }
}
