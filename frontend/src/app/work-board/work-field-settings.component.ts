import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { WorkBoardService, WorkCurrencyPreference } from '../services/work-board.service';
import { WORK_CATALOGS, WORK_FIELD_CARDS, WORK_FIELD_TYPES, WorkCatalog, WorkField, WorkFieldOption, WorkFieldSettings, WorkSettingsChange } from './work-fields';

@Component({
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './work-field-settings.component.html',
  styles: [`
    :host { display: block; color: var(--brand-ink); }
    main { max-width: 1080px; margin: auto; padding: clamp(16px, 4vw, 36px); display: grid; gap: 18px; }
    h2, h3, p { margin: 0; }
    .muted { color: var(--brand-muted); }
    header { display: grid; gap: 5px; }
    .panel { display: grid; gap: 14px; min-width: 0; padding: clamp(12px, 3vw, 24px);
      background: var(--brand-panel); border: 1px solid var(--brand-border); border-radius: 14px; }
    .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
    .field-row { padding-top: 12px; border-top: 1px solid var(--brand-border); }
    .form-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
    .options { display: grid; gap: 8px; }
    .options mat-form-field { flex: 1 1 12rem; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .error { color: var(--brand-error); }
  `]
})
export class WorkFieldSettingsComponent implements OnInit {
  private readonly board = inject(WorkBoardService);
  readonly cards = WORK_FIELD_CARDS;
  readonly types = WORK_FIELD_TYPES;
  readonly catalogs = WORK_CATALOGS;
  config?: WorkFieldSettings;
  draft?: WorkField;
  catalogDraft?: { catalog: WorkCatalog; entry: WorkFieldOption };
  currencyPreference?: WorkCurrencyPreference;
  defaultCurrency = '';
  currencyBusy = false;
  busy = false;
  error = '';
  notice = '';

  ngOnInit(): void { void this.load(); void this.loadCurrency(); }

  private async loadCurrency(): Promise<void> {
    try {
      this.currencyPreference = await firstValueFrom(this.board.currencyPreference());
      this.defaultCurrency = this.currencyPreference.defaultCurrency;
    } catch (error) { this.showError(error); }
  }

  async saveCurrency(): Promise<void> {
    if (this.currencyBusy || !this.currencyPreference || this.defaultCurrency === this.currencyPreference.defaultCurrency) return;
    this.currencyBusy = true;
    this.error = this.notice = '';
    try {
      this.currencyPreference = await firstValueFrom(this.board.saveCurrencyPreference(this.defaultCurrency));
      this.defaultCurrency = this.currencyPreference.defaultCurrency;
      this.notice = 'Default currency saved.';
    } catch (error) { this.showError(error); }
    finally { this.currencyBusy = false; }
  }

  async load(): Promise<void> {
    try { this.config = await firstValueFrom(this.board.fieldSettings()); }
    catch (error) { this.showError(error); }
  }

  newField(): void {
    this.draft = { id: '', label: '', card: 'basic', type: 'text', multiple: false, options: [],
      required: false, showInList: false, archived: false };
  }

  edit(field: WorkField): void { this.draft = structuredClone(field); }
  toggleArchived(field: WorkField): void { void this.save({ field: { ...field, archived: !field.archived } }); }
  editCatalog(catalog: WorkCatalog, entry = { id: '', label: '', archived: false }): void {
    this.catalogDraft = { catalog, entry: { ...entry } };
  }
  toggleCatalogArchived(catalog: WorkCatalog, entry: WorkFieldOption): void {
    void this.save({ catalog, entry: { ...entry, archived: !entry.archived } });
  }
  cardLabel(field: WorkField): string { return this.cards.find((card) => card.id === field.card)?.label || ''; }
  typeLabel(field: WorkField): string {
    return field.type === 'list' ? (field.multiple ? 'Multi-select list' : 'Single-select list')
      : this.types.find((type) => type.id === field.type)?.label || '';
  }

  async save(change: WorkSettingsChange): Promise<void> {
    if (this.busy || !this.config) return;
    this.busy = true;
    this.error = this.notice = '';
    try {
      this.config = await firstValueFrom(this.board.saveFieldSettings(this.config.version, change));
      this.draft = undefined;
      this.catalogDraft = undefined;
      this.notice = 'field' in change ? 'Field settings saved.' :
        'catalog' in change ? 'Catalog entry saved.' : 'Project size setting saved.';
    } catch (error) {
      this.showError(error);
      if ((error as { status?: number }).status === 409) {
        this.draft = undefined;
        this.catalogDraft = undefined;
        await this.load();
      }
    } finally { this.busy = false; }
  }

  private showError(error: unknown): void {
    this.error = (error as { error?: { error?: string } }).error?.error || 'Work settings could not be loaded or saved.';
  }
}
