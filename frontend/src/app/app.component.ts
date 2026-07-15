import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatToolbarModule,
    MatTooltipModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  isPublicRoute = false;
  currentUrl = '';

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    private router: Router
  ) {
    this.currentUrl = this.router.url;
    this.isPublicRoute = this.isPublicPath(this.currentUrl);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl = (event as NavigationEnd).urlAfterRedirects;
        this.isPublicRoute = this.isPublicPath(this.currentUrl);
      });
  }

  get isWebhookSectionActive(): boolean {
    return this.currentPath.startsWith('/webhook');
  }

  get isWebhookTesterRoute(): boolean {
    return this.currentPath === '/webhook';
  }

  private isPublicPath(url: string): boolean {
    return url.startsWith('/status/');
  }

  private get currentPath(): string {
    return this.currentUrl.split(/[?#]/)[0] || '/';
  }

  preventCurrentWebhookClick(event: MouseEvent): void {
    if (!this.isWebhookTesterRoute) return;
    event.preventDefault();
    event.stopPropagation();
  }

  logout(): void {
    this.auth.logout();
  }
}
