import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DashboardFilter, DashboardWorks, WorkBoardService } from '../services/work-board.service';

@Component({
  imports: [CommonModule, RouterLink, MatButtonModule],
  templateUrl: './work-dashboard.component.html',
  styleUrl: './work-dashboard.component.scss'
})
export class WorkDashboardComponent implements OnInit {
  private readonly board = inject(WorkBoardService);
  readonly dashboardState = this.board.dashboardState;
  private readonly dashboard = computed(() => this.dashboardState().report);
  readonly chartMax = computed(() => this.dashboard()?.owners.reduce((max, owner) => Math.max(max, owner.active, owner.leads), 1) ?? 1);
  readonly deadlineMax = computed(() => this.dashboard()?.deadlines.reduce((max, item) => Math.max(max, item.count), 1) ?? 1);
  readonly entityMax = computed(() => this.dashboard()?.entities.reduce((max, entity) => Math.max(max, entity.total), 1) ?? 1);
  private readonly financeRange = computed(() => {
    let positive = 0;
    let negative = 0;
    for (const metric of this.dashboard()?.finance ?? []) {
      const amount = metric.value.amount ?? 0;
      positive = Math.max(positive, amount);
      negative = Math.max(negative, -amount);
    }
    return { positive, negative };
  });
  selection?: { filter: DashboardFilter; title: string };
  selectedWorks?: DashboardWorks;
  selectionError = '';
  private selectionTrigger?: HTMLElement;
  private request = 0;
  @ViewChild('selectionHeading') private selectionHeading?: ElementRef<HTMLHeadingElement>;

  ngOnInit(): void { this.board.ensureDashboard(); }

  refresh(): void { this.board.refreshDashboard(); }

  get sizeCount(): number { return this.dashboard()?.sizes?.reduce((total, size) => total + size.count, 0) || 0; }

  get positiveShare(): number {
    const { positive, negative } = this.financeRange();
    const range = positive + negative;
    return range ? positive / range * 100 : 100;
  }

  barHeight(amount: number | null): number {
    const { positive, negative } = this.financeRange();
    const max = (amount || 0) < 0 ? negative : positive;
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
