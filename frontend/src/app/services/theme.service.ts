import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, signal } from '@angular/core';

export type ColorTheme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'epds-admin-theme';
  readonly theme = signal<ColorTheme>(this.getInitialTheme());

  constructor(@Inject(DOCUMENT) private readonly document: Document) {
    this.applyTheme(this.theme());
  }

  toggle(): void {
    const nextTheme: ColorTheme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(nextTheme);
    this.applyTheme(nextTheme);

    try {
      localStorage.setItem(this.storageKey, nextTheme);
    } catch {
      // Theme switching remains available when browser storage is blocked.
    }
  }

  private getInitialTheme(): ColorTheme {
    try {
      const storedTheme = localStorage.getItem(this.storageKey);
      if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
    } catch {
      // Fall back to the operating system preference.
    }

    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private applyTheme(theme: ColorTheme): void {
    const root = this.document.documentElement;
    root.classList.toggle('dark-theme', theme === 'dark');
    root.style.colorScheme = theme;
  }
}
