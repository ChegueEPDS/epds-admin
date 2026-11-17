import { Component, input, output } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { LayoutItem } from './work-fields';

@Component({
  selector: 'app-work-layout-list',
  imports: [CdkDrag, CdkDragHandle, CdkDropList, MatButtonModule, MatCheckboxModule, MatIconModule],
  template: `
    <ol cdkDropList [cdkDropListDisabled]="disabled()" (cdkDropListDropped)="drop($event)">
      @for (item of items(); track item.id; let i = $index) {
        <li cdkDrag>
          <span class="handle" cdkDragHandle aria-hidden="true"><mat-icon class="material-symbols-outlined">drag_indicator</mat-icon></span>
          @if (fieldVisibility()) {
            <span>{{ item.label }} @if (item.required) { <small>Required</small> }</span>
            <button mat-icon-button type="button" [disabled]="disabled() || item.required"
              [attr.aria-label]="(item.visible ? 'Hide ' : 'Show ') + item.label"
              [title]="item.required ? 'Required field' : (item.visible ? 'Hide field' : 'Show field')"
              (click)="toggle(i, !item.visible)">
              <mat-icon class="material-symbols-outlined">{{ item.visible ? 'visibility' : 'visibility_off' }}</mat-icon>
            </button>
          } @else if (item.visible !== undefined) {
            <mat-checkbox [checked]="item.visible" [disabled]="disabled() || (item.visible && visibleCount === 1)"
              (change)="toggle(i, $event.checked)">{{ item.label }}</mat-checkbox>
          } @else {
            <span>{{ item.label }}</span>
          }
          <button mat-icon-button type="button" [disabled]="disabled() || i === 0"
            [attr.aria-label]="'Move ' + item.label + ' up'" (click)="move(i, i - 1)"><mat-icon class="material-symbols-outlined">keyboard_arrow_up</mat-icon></button>
          <button mat-icon-button type="button" [disabled]="disabled() || i === items().length - 1"
            [attr.aria-label]="'Move ' + item.label + ' down'" (click)="move(i, i + 1)"><mat-icon class="material-symbols-outlined">keyboard_arrow_down</mat-icon></button>
        </li>
      }
    </ol>
  `,
  styles: [`
    ol { display: grid; gap: 4px; list-style: none; margin: 0; padding: 0; max-width: 38rem; }
    li { display: flex; gap: 4px; align-items: center;
      background: var(--brand-panel); color: var(--brand-ink); border: 1px solid var(--brand-border); border-radius: 8px; padding-inline: 8px; }
    li > :nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    li > button { flex: none; }
    small { color: var(--brand-muted); margin-inline-start: 4px; }
    .handle { display: flex; color: var(--brand-muted); cursor: grab; touch-action: none; }
    .cdk-drag-placeholder { opacity: .35; }
  `]
})
export class WorkLayoutListComponent {
  readonly items = input.required<LayoutItem[]>();
  readonly disabled = input(false);
  readonly fieldVisibility = input(false);
  readonly itemsChange = output<LayoutItem[]>();

  get visibleCount(): number { return this.items().filter((item) => item.visible).length; }

  drop(event: CdkDragDrop<unknown>): void { this.move(event.previousIndex, event.currentIndex); }

  move(from: number, to: number): void {
    if (from === to || this.disabled()) return;
    const items = [...this.items()];
    moveItemInArray(items, from, to);
    this.itemsChange.emit(items);
  }

  toggle(index: number, visible: boolean): void {
    if (this.disabled() || this.items()[index].required) return;
    this.itemsChange.emit(this.items().map((item, i) => i === index ? { ...item, visible } : item));
  }
}
