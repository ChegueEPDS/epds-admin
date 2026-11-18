import { Component, OnInit, TemplateRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { WorkBoardService, WorkCurrencyPreference } from '../services/work-board.service';
import { WORK_TABLE_COLUMNS, WORK_CATALOGS, WORK_FIELD_CARDS, WORK_FIELD_TYPES, WorkCatalog, WorkField, WorkFieldOption, WorkFieldSettings, WorkSettingsChange, WorkFieldCard, WorkFieldOrder, LayoutItem, cardLayout, orderLayout } from './work-fields';
import { WorkLayoutListComponent } from './work-layout-list.component';

@Component({
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatDialogModule, WorkLayoutListComponent],
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
    .tab-content { display: grid; gap: 12px; padding-block: 16px; }
    .layout-card { min-width: 0; border: 1px solid var(--brand-border); border-radius: 12px; background: var(--brand-panel); }
    .layout-card summary { padding: 14px 16px; cursor: pointer; }
    .layout-card summary span { margin-inline-start: 8px; font-size: .8rem; color: var(--brand-muted); }
    .layout-content { display: grid; gap: 10px; padding: 0 14px 14px; }
    .layout-actions { position: sticky; bottom: 0; z-index: 2; padding: 12px; background: var(--brand-panel);
      border: 1px solid var(--brand-border); border-radius: 12px; box-shadow: var(--brand-shadow-sm); }
    .drawer-fields { display: grid; gap: 12px; max-height: none; }
    .archived { margin-block: 8px; }
  `]
})
export class WorkFieldSettingsComponent implements OnInit {
  private readonly board = inject(WorkBoardService);
  private readonly dialog = inject(MatDialog);
  private fieldDialog?: MatDialogRef<unknown>;
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
  readonly tableOnlyColumns = [{ id: 'workNumber', label: 'Work no.' }, { id: 'subWorkCount', label: 'Sub-works' }];
  private readonly fieldDrafts = new Map<string, WorkField>();
  private orders: WorkFieldOrder = {};
  private hidden = new Set<string>();
  private columns: Record<string, boolean> = {};
  layoutDirty = false;

  get fields(): WorkField[] {
    const fields = new Map(this.config?.fields.map((field) => [field.id, field]));
    for (const [id, draft] of this.fieldDrafts) fields.set(id, { ...draft, id });
    return [...fields.values()];
  }
  get archivedFields(): WorkField[] { return this.fields.filter((field) => field.archived); }
  hiddenCount(items: LayoutItem[]): number { return items.filter((item) => !item.visible).length; }
  canRemoveField(id: string): boolean { return !id.startsWith('new:') || this.fieldDrafts.has(id); }

  layoutItems(card: WorkFieldCard): LayoutItem[] {
    const fields = this.fields;
    const byId = new Map(fields.map((field) => [field.id, field]));
    return orderLayout(cardLayout(card, fields, this.hidden), this.orders[card] ?? this.config?.fieldOrder?.[card])
      .map((item) => {
        const field = byId.get(item.id);
        return { ...item, editable: !!field, fieldType: field ? this.typeLabel(field) : undefined,
          tableVisible: field || WORK_TABLE_COLUMNS.has(item.id) ? this.defaultTableVisibility(item.id, field?.showInList ?? true) : undefined };
      });
  }

  changeLayout(card: WorkFieldCard, items: LayoutItem[]): void {
    this.orders[card] = items.map(({ id }) => id);
    for (const item of items) {
      if (item.visible === false) this.hidden.add(item.id);
      else this.hidden.delete(item.id);
    }
    this.layoutDirty = true;
  }

  defaultTableVisibility(id: string, fallback = true): boolean { return this.columns[id] ?? fallback; }

  setColumnVisibility(id: string, visible: boolean): void {
    this.columns[id] = visible;
    this.layoutDirty = true;
  }

  resetOrder(card: WorkFieldCard): void { this.orders[card] = []; this.layoutDirty = true; }

  discardLayout(): void {
    this.fieldDrafts.clear();
    this.orders = {};
    this.hidden = new Set(this.config?.hiddenFields);
    this.columns = { ...this.config?.columnVisibility };
    this.layoutDirty = false;
  }

  saveLayout(): void {
    const fields = this.fields.filter((field) => !field.archived);
    const fieldIds = new Set(fields.map(({ id }) => id));
    const savedOrders = { ...this.orders };
    for (const card of this.cards) {
      if (savedOrders[card.id]?.length) savedOrders[card.id] = this.layoutItems(card.id).map(({ id }) => id);
    }
    void this.save({ layout: {
      fields: [...this.fieldDrafts].map(([key, field]) => ({ key, field })),
      orders: savedOrders, hidden: [...this.hidden].filter((id) => !this.fields.some((field) => field.id === id && field.archived)),
      columns: Object.fromEntries(Object.entries(this.columns).filter(([id]) => WORK_TABLE_COLUMNS.has(id) || fieldIds.has(id)))
    } });
  }

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
    try {
      this.config = await firstValueFrom(this.board.fieldSettings());
      this.discardLayout();
    }
    catch (error) { this.showError(error); }
  }

  newField(card: WorkFieldCard, editor: TemplateRef<unknown>): void {
    this.openField({ id: 'new:' + crypto.randomUUID(), label: '', card, type: 'text', multiple: false, options: [],
      required: false, showInList: false, archived: false }, editor);
  }

  editField(id: string, editor: TemplateRef<unknown>): void {
    const field = this.fields.find((item) => item.id === id);
    if (field) this.openField(field, editor);
  }

  private openField(field: WorkField, editor: TemplateRef<unknown>): void {
    this.draft = structuredClone(field);
    this.fieldDialog = this.dialog.open(editor, {
      width: '480px', maxWidth: '100vw', height: '100dvh', position: { top: '0', right: '0' },
      ariaLabelledBy: 'tracker-field-editor-title'
    });
    this.fieldDialog.afterClosed().subscribe(() => { this.draft = undefined; this.fieldDialog = undefined; });
  }

  stageField(field: WorkField): void {
    this.fieldDrafts.set(field.id, { ...field, id: field.id.startsWith('new:') ? '' : field.id });
    if (field.required) this.hidden.delete(field.id);
    this.layoutDirty = true;
    this.fieldDialog?.close();
  }

  toggleArchived(field: WorkField): void {
    if (field.id.startsWith('new:')) {
      this.fieldDrafts.delete(field.id);
      this.hidden.delete(field.id);
      this.fieldDialog?.close();
    } else this.stageField({ ...field, archived: !field.archived });
  }
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
      if ('layout' in change) this.discardLayout();
      this.notice = 'field' in change ? 'Field settings saved.' :
        'catalog' in change ? 'Catalog entry saved.' : 'layout' in change ? 'Field layout saved.' : 'Project size setting saved.';
    } catch (error) {
      this.showError(error);
      if ((error as { status?: number }).status === 409 && !this.layoutDirty) {
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
