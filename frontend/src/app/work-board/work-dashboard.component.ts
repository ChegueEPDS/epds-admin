import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DashboardFilter, DashboardWorks, WorkBoardService, WorkDashboard } from '../services/work-board.service';

@Component({
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './work-dashboard.component.html',
  styleUrl: './work-dashboard.component.scss'
})
export class WorkDashboardComponent implements OnInit {
  private readonly board = inject(WorkBoardService);
  dashboard?: WorkDashboard;
  chartMax = 1;
  deadlineMax = 1;
  entityMax = 1;
  financePositive = 0;
  financeNegative = 0;
  selection?: { filter: DashboardFilter; title: string };
  selectedWorks?: DashboardWorks;
  selectionError = '';
  private selectionTrigger?: HTMLElement;
  private request = 0;
  @ViewChild('selectionHeading') private selectionHeading?: ElementRef<HTMLHeadingElement>;
  error = '';

  ngOnInit(): void { void this.load(); }

  private async load(): Promise<void> {
    try {
      this.dashboard = await firstValueFrom(this.board.dashboard());
      this.chartMax = this.dashboard.owners.reduce((maximum, owner) => Math.max(maximum, owner.active, owner.leads), 1);
      this.deadlineMax = this.dashboard.deadlines.reduce((maximum, item) => Math.max(maximum, item.count), 1);
      this.entityMax = this.dashboard.entities.reduce((maximum, entity) => Math.max(maximum, entity.total), 1);
      for (const metric of this.dashboard.finance) {
        const amount = metric.value.amount ?? 0;
        this.financePositive = Math.max(this.financePositive, amount);
        this.financeNegative = Math.max(this.financeNegative, -amount);
      }
    }
    catch (error) {
      this.error = (error as { error?: { error?: string } }).error?.error || 'The dashboard could not be loaded.';
    }
  }

  get sizeCount(): number { return this.dashboard?.sizes?.reduce((total, size) => total + size.count, 0) || 0; }

  get positiveShare(): number {
    const range = this.financePositive + this.financeNegative;
    return range ? this.financePositive / range * 100 : 100;
  }

  barHeight(amount: number | null): number {
    const max = (amount || 0) < 0 ? this.financeNegative : this.financePositive;
    return max ? Math.abs(amount || 0) / max * 100 : 0;
  }

  select(filter: DashboardFilter, title: string, trigger: EventTarget | null): void {
    this.selectionTrigger = trigger instanceof HTMLElement ? trigger : undefined;
    this.selection = { filter, title };
    void this.loadSelection(1);
    requestAnimationFrame(() => this.selectionHeading?.nativeElement.focus());
  }

  selected(kind: DashboardFilter['kind'], value: string, entityId?: string): boolean {
    const filter = this.selection?.filter;
    return filter?.kind === kind && filter.value === value && filter.entityId === entityId;
  }

  async loadSelection(page: number): Promise<void> {
    if (!this.selection) return;
    const request = ++this.request;
    this.selectionError = '';
    this.selectedWorks = undefined;
    try {
      const results = await firstValueFrom(this.board.dashboardWorks(this.selection.filter, page));
      if (request === this.request) this.selectedWorks = results;
    } catch (error) {
      if (request === this.request) this.selectionError =
        (error as { error?: { error?: string } }).error?.error || 'The selected works could not be loaded.';
    }
  }

  closeSelection(): void {
    this.request++;
    this.selection = undefined;
    this.selectedWorks = undefined;
    this.selectionTrigger?.focus();
  }
}
