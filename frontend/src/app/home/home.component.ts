import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService, TenantFeatureKey } from '../services/auth.service';

type FeatureCard = {
  title: string;
  icon: string;
  route: string;
  description: string;
  featureKey: TenantFeatureKey;
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, MatCardModule, MatIconModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
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
      title: 'Effort Tracking',
      icon: 'timer',
      route: '/effort-tracking',
      description: 'Project tasks, timers and net/gross effort totals.',
      featureKey: 'effortTracking'
    }
  ];

  constructor(public auth: AuthService) {}

  get visibleCards(): FeatureCard[] {
    return this.cards.filter((card) => this.auth.canAccessFeature(card.featureKey));
  }
}
