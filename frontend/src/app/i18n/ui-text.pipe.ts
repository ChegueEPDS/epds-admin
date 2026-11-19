import { Pipe, PipeTransform, inject } from '@angular/core';
import { UiLanguageService } from './ui-language.service';

@Pipe({ name: 'uiText', standalone: true, pure: false })
export class UiTextPipe implements PipeTransform {
  private readonly ui = inject(UiLanguageService);

  transform<T extends string | null | undefined>(source: T, ...values: unknown[]): string | Exclude<T, string> {
    if (typeof source !== 'string') return source as Exclude<T, string>;
    return this.ui.text(source, ...values);
  }
}
