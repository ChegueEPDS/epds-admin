import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [MatIconModule, MatTabsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    @if (auth.isWorkFieldTenant()) {
      <nav mat-tab-nav-bar [tabPanel]="panel" [mat-stretch-tabs]="true" aria-label="Work board views">
        <a mat-tab-link routerLink="/work-board/dashboard" routerLinkActive #dashboard="routerLinkActive"
          [active]="dashboard.isActive">
          <mat-icon class="material-symbols-outlined" aria-hidden="true">dashboard</mat-icon>Dashboard
        </a>
        <a mat-tab-link routerLink="/work-board" routerLinkActive #table="routerLinkActive"
          [routerLinkActiveOptions]="{ paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' }"
          [active]="table.isActive">
          <mat-icon class="material-symbols-outlined" aria-hidden="true">table_rows</mat-icon>Table
        </a>
      </nav>
    }
    <mat-tab-nav-panel #panel><router-outlet/></mat-tab-nav-panel>
  `,
  styles: [`
    :host { display: block; --work-board-inset: 34px; }
    nav { margin: 12px var(--work-board-inset) 0; border-bottom: 1px solid var(--brand-border); }
    a[mat-tab-link] { flex-basis: 0; min-width: 0; }
    mat-icon { margin-inline-end: 8px; }
    @media (max-width: 760px) { :host { --work-board-inset: 16px; } }
  `]
})
export class WorkBoardPageComponent {
  protected readonly auth = inject(AuthService);
}
