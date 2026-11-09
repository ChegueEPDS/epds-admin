import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BoardSettings, CatalogEntry, Field, FieldTarget, FieldType, ProjectTrackerService, Rate, Settings } from './project-tracker.service';

const boardLocations = {
  work: ['boardEditor', 'boardDetails', 'boardList', 'trackerEditor', 'trackerDetails', 'trackerList'],
  subWork: ['subWorkEditor', 'subWorkDetails'], client: ['clientEditor', 'clientDetails'],
  group: ['groupEditor', 'groupDetails'], task: ['taskEditor', 'taskDetails']
};
const locationLabels: Record<string, string> = {
  boardEditor: 'Work Board editor', boardDetails: 'Work Board details', boardList: 'Work Board list',
  trackerEditor: 'Project Tracker editor', trackerDetails: 'Project Tracker details', trackerList: 'Project Tracker list',
  subWorkEditor: 'Sub-work editor', subWorkDetails: 'Sub-work details', clientEditor: 'Client editor',
  clientDetails: 'Client details', groupEditor: 'Group editor', groupDetails: 'Group details',
  taskEditor: 'Action editor', taskDetails: 'Action details'
};

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './project-tracker-settings.component.html',
  styleUrl: './project-tracker.scss'
})
export class ProjectTrackerSettingsComponent implements OnInit {
  private readonly api = inject(ProjectTrackerService);
  record?: BoardSettings;
  settings?: Settings;
  stages = ['Lead', 'Active', 'On hold', 'Completed', 'Cancelled', 'Lost'];
  types: FieldType[] = ['text', 'longText', 'number', 'date', 'boolean', 'select', 'multiSelect', 'user', 'url'];
  days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  locationLabels = locationLabels;
  error = '';
  notice = '';
  busy = false;

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    try {
      this.record = await firstValueFrom(this.api.boardSettings());
      this.settings = structuredClone(this.record.data);
    } catch (error) { this.error = errorText(error); }
  }

  get targets(): FieldTarget[] { return this.record?.tracker ? ['work', 'subWork', 'client', 'group', 'task'] : ['work', 'subWork', 'client']; }

  locations(field: Field): string[] {
    return boardLocations[field.target].filter((location) => this.record?.tracker || !location.startsWith('tracker') || field.locations.includes(location));
  }

  toggle(field: Field, location: string, checked: boolean): void {
    field.locations = checked ? [...field.locations, location] : field.locations.filter((value) => value !== location);
  }

  addCatalog(items: CatalogEntry[]): void { items.push({ id: '', name: '', code: '' }); }
  removeCatalog(items: CatalogEntry[], index: number): void {
    const item = items[index];
    if (item.id) item.archived = !item.archived;
    else items.splice(index, 1);
  }
  addField(): void {
    this.settings?.fields.push({ id: '', label: '', target: 'work', type: 'text', locations: ['boardEditor', 'boardDetails'], options: [], required: false });
  }
  removeField(field: Field, index: number): void {
    if (field.id) field.archived = !field.archived;
    else this.settings?.fields.splice(index, 1);
  }
  addRate(rates: Rate[]): void { rates.push({ currency: '', effective: '', unitsPerEur: 1 }); }

  async save(ratesOnly = false): Promise<void> {
    if (!this.record || !this.settings || this.busy) return;
    this.busy = true;
    this.notice = '';
    this.error = '';
    try {
      if (ratesOnly) await firstValueFrom(this.api.saveRates(this.record.version, this.settings.rates));
      else {
        const data = { ...this.settings, rates: this.record.data.rates };
        await firstValueFrom(this.api.saveSettings(this.record.version, data));
      }
      await this.load();
      this.notice = 'Settings saved.';
    } catch (error) { this.error = errorText(error); }
    finally { this.busy = false; }
  }
}

export function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const payload = error.error;
    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error;
  }
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
