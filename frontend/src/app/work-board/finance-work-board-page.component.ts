import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { WorkBoardComponent } from './work-board.component';

@Component({
  imports: [AsyncPipe, WorkBoardComponent],
  template: `
    @for (tenantId of tenantIds$ | async; track tenantId) {
      <app-work-board [financeTenantId]="tenantId"/>
    }
  `
})
export class FinanceWorkBoardPageComponent {
  // Each tenant gets its own table, filters and editor state.
  protected readonly tenantIds$ = inject(ActivatedRoute).paramMap.pipe(
    map((params) => [params.get('tenantId')!])
  );
}
