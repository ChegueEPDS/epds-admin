import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { AuthService, TenantFeatureKey } from '../services/auth.service';
import { DomainHealthService } from '../services/domain-health.service';
import { LicenseCustomer, LicenseService } from '../services/license.service';

type FeatureCard = {
  title: string;
  icon: string;
  route: string;
  description: string;
  featureKey?: TenantFeatureKey;
  superAdminOnly?: boolean;
  opensInNewTab?: boolean;
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, MatCardModule, MatIconModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly issueFeatureKeys = new Set<TenantFeatureKey>();
  private readonly unavailableFeatureKeys = new Set<TenantFeatureKey>();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private hasStartedStatusCheck = false;
  isCheckingSystemStatus = true;

  cards: FeatureCard[] = [
    {
      title: 'Noreply Mailbox',
      icon: 'mail',
      route: '/mail',
      description: 'Mailbox, sent items and message sending.',
      featureKey: 'mail'
    },
    {
      title: 'Domain Health',
      icon: 'health_and_safety',
      route: '/domain-health',
      description: 'MX, SPF, DMARC and DKIM checks.',
      featureKey: 'domainHealth'
    },
    {
      title: 'Licenses',
      icon: 'license',
      route: '/licenses',
      description: 'Customer license status, object limits and expiry dates.',
      featureKey: 'licenses'
    },
    {
      title: 'Work Board',
      icon: 'view_list',
      route: '/work-board',
      description: 'Works, sub-works, deadlines and billing milestones.',
      featureKey: 'workBoard'
    },
    {
      title: 'Effort Tracking',
      icon: 'timer',
      route: '/effort-tracking',
      description: 'Project tasks, timers and net/gross effort totals.',
      featureKey: 'effortTracking'
    },
    {
      title: 'Webhook Tester',
      icon: 'webhook',
      route: '/webhook',
      description: 'Inspect received webhook payloads and verify signatures.',
      featureKey: 'webhookTester',
      opensInNewTab: true
    },
    {
      title: 'FIT Editor',
      icon: 'directions_bike',
      route: '/admin/fit-editor',
      description: 'Analyze and edit running and cycling FIT activity files.',
      superAdminOnly: true
    }
  ];

  constructor(
    public auth: AuthService,
    private readonly domainHealthService: DomainHealthService,
    private readonly licenseService: LicenseService
  ) {}

  ngOnInit(): void {
    void this.loadSystemStatus();
    this.refreshTimer = setInterval(() => void this.loadSystemStatus(), 120000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  get visibleCards(): FeatureCard[] {
    return this.cards.filter((card) =>
      card.superAdminOnly ? this.auth.isSuperAdmin() : Boolean(card.featureKey && this.auth.canAccessFeature(card.featureKey))
    );
  }

  get hasActiveIssues(): boolean {
    return this.issueFeatureKeys.size > 0;
  }

  get hasUnavailableStatus(): boolean {
    return this.unavailableFeatureKeys.size > 0;
  }

  get systemStatusLabel(): string {
    if (this.isCheckingSystemStatus) return 'Checking systems';
    if (this.hasActiveIssues) return 'Active issues';
    if (this.hasUnavailableStatus) return 'Status unavailable';
    return 'Systems ready';
  }

  hasCardWarning(featureKey?: TenantFeatureKey): boolean {
    if (!featureKey) return false;
    return this.issueFeatureKeys.has(featureKey) || this.unavailableFeatureKeys.has(featureKey);
  }

  hasCardActiveIssue(featureKey?: TenantFeatureKey): boolean {
    if (!featureKey) return false;
    return this.issueFeatureKeys.has(featureKey);
  }

  private async loadSystemStatus(): Promise<void> {
    if (this.hasStartedStatusCheck && this.isCheckingSystemStatus) return;

    this.hasStartedStatusCheck = true;
    this.isCheckingSystemStatus = true;
    this.issueFeatureKeys.clear();
    this.unavailableFeatureKeys.clear();

    const checks: Promise<void>[] = [];
    if (this.auth.canAccessFeature('domainHealth')) checks.push(this.checkDomainHealth());
    if (this.auth.canAccessFeature('licenses')) checks.push(this.checkLicenses());

    await Promise.all(checks);
    this.isCheckingSystemStatus = false;
  }

  private async checkDomainHealth(): Promise<void> {
    try {
      const response = await firstValueFrom(this.domainHealthService.listDomains());
      if (response.domains.some((domain) => domain.enabled && domain.displayStatus === 'error')) {
        this.issueFeatureKeys.add('domainHealth');
      }
    } catch {
      this.unavailableFeatureKeys.add('domainHealth');
    }
  }

  private async checkLicenses(): Promise<void> {
    try {
      const response = await firstValueFrom(this.licenseService.listLicenses());
      if (response.licenses.some((license) => this.isProblemLicense(license))) {
        this.issueFeatureKeys.add('licenses');
      }
    } catch {
      this.unavailableFeatureKeys.add('licenses');
    }
  }

  private isProblemLicense(license: LicenseCustomer): boolean {
    if (license.status === 'expired' || license.status === 'ordered' || license.status === 'pending') return true;
    if (license.status !== 'active') return false;

    const expiresAt = new Date(license.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiresAt < today;
  }
}
