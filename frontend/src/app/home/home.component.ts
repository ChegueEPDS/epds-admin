import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../services/auth.service';

type FeatureCard = {
  title: string;
  icon: string;
  route: string;
  description: string;
  epdsOnly?: boolean;
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
      description: 'Mailbox, sent items and message sending.'
    },
    {
      title: 'Domain Health',
      icon: 'health_and_safety',
      route: '/domain-health',
      description: 'MX, SPF, DMARC and DKIM checks.'
    },
    {
      title: 'Licenses',
      icon: 'license',
      route: '/licenses',
      description: 'Customer license status, object limits and expiry dates.'
    },
    {
      title: 'Effort Tracking',
      icon: 'timer',
      route: '/effort-tracking',
      description: 'Project tasks, timers and net/gross effort totals.',
      epdsOnly: true
    }
  ];

  constructor(public auth: AuthService) {}

  get visibleCards(): FeatureCard[] {
    return this.cards.filter((card) => !card.epdsOnly || this.auth.hasEpdsEmail());
  }
}
