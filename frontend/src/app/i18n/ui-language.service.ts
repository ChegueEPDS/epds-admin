import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { EN_UI_TEXTS } from './ui-texts.en';

export type UiLanguage = 'en' | 'hu';
const STORAGE_KEY = 'panda-ui-language';

@Injectable({ providedIn: 'root' })
export class UiLanguageService {
  private readonly document = inject(DOCUMENT);
  private readonly selected = signal<UiLanguage>('en');
  private requested: UiLanguage = 'en';
  private hungarianTexts?: Readonly<Record<string, string>>;
  readonly language = this.selected.asReadonly();
  readonly locale = computed(() => this.language() === 'hu' ? 'hu-HU' : 'en-GB');

  initialize(): Promise<void> {
    let saved: string | null | undefined;
    try {
      saved = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
    } catch {
      // The language switch still works when browser storage is unavailable.
    }
    return saved === 'hu' ? this.setLanguage('hu') : Promise.resolve();
  }

  async setLanguage(language: UiLanguage): Promise<void> {
    if (language !== 'en' && language !== 'hu') return;
    this.requested = language;
    if (language === 'hu' && !this.hungarianTexts) {
      try {
        const { HU_UI_TEXTS } = await import('./ui-texts.hu');
        this.hungarianTexts = HU_UI_TEXTS;
      } catch {
        if (this.requested === 'hu') this.applyLanguage('en');
        return;
      }
    }
    if (this.requested === language) this.applyLanguage(language);
  }

  text(source: string, ...values: unknown[]): string {
    const catalog = this.language() === 'hu' ? this.hungarianTexts ?? EN_UI_TEXTS : EN_UI_TEXTS;
    const text = Object.hasOwn(catalog, source) ? catalog[source] : source;
    return values.length ? text.replace(/\{(\d+)\}/g, (match, index) =>
      Number(index) < values.length ? String(values[Number(index)] ?? '') : match
    ) : text;
  }

  private applyLanguage(language: UiLanguage): void {
    this.selected.set(language);
    this.document.documentElement.lang = language;
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Keep the selection for the current session.
    }
  }
}
