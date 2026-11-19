import { AfterViewInit, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';

@Component({
  selector: 'app-epds-atex-panda',
  standalone: true,
  templateUrl: './epds-atex-panda.component.html',
  styleUrl: './epds-atex-panda.component.scss'
})
export class EpdsAtexPandaComponent implements AfterViewInit, OnDestroy {
  private static nextId = 0;

  @Input() size = 280;
  @ViewChild('rig', { static: true }) private rigRef!: ElementRef<HTMLElement>;
  @ViewChild('pupilLeft', { static: true }) private pupilLeftRef!: ElementRef<SVGGElement>;
  @ViewChild('pupilRight', { static: true }) private pupilRightRef!: ElementRef<SVGGElement>;
  @ViewChild('shadowGroup', { static: true }) private shadowRef!: ElementRef<SVGGElement>;

  readonly svgId = `epds-panda-${EpdsAtexPandaComponent.nextId++}-`;
  private readonly ngZone = inject(NgZone);
  private readonly timers = new Set<number>();
  private frame = 0;
  private initialGreeting?: number;
  private greetingEnd?: number;
  private motionPreference?: MediaQueryList;

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (this.motionPreference.matches) return;
      this.runMotion();
      this.initialGreeting = this.schedule(() => {
        this.initialGreeting = undefined;
        this.greet();
      }, 650);
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.timers.forEach(timer => window.clearTimeout(timer));
    this.timers.clear();
  }

  greet(): void {
    if (this.motionPreference?.matches) return;
    this.ngZone.runOutsideAngular(() => {
      this.clearTimer(this.initialGreeting);
      this.initialGreeting = undefined;
      this.clearTimer(this.greetingEnd);
      const rig = this.rigRef.nativeElement;
      rig.classList.remove('is-bouncing');
      void rig.offsetWidth;
      rig.classList.add('is-bouncing');
      this.greetingEnd = this.schedule(() => {
        rig.classList.remove('is-bouncing');
        this.greetingEnd = undefined;
      }, 720);
    });
  }

  private clearTimer(timer: number | undefined): void {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.timers.delete(timer);
  }

  private schedule(callback: () => void, delay: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  private runMotion(): void {
    const rig = this.rigRef.nativeElement;
    const layers = Array.from(rig.querySelectorAll<HTMLElement>('.panda-layer'));
    const pupilLeft = this.pupilLeftRef.nativeElement;
    const pupilRight = this.pupilRightRef.nativeElement;
    const shadowGroup = this.shadowRef.nativeElement;
    // Állapotváltozók az önálló, nyugodt 2.5D animációhoz
    let currentRX = 0;
    let currentRY = 0;
    let currentFloatY = 0;

    let targetEyeX = 0;
    let targetEyeY = 0;
    let currentEyeX = 0;
    let currentEyeY = 0;

    // Kíváncsi lepillantás a pajzsra két fülmozgás között (a tábla mozgatása nélkül)
    let glanceProgress = 0;
    let glanceTarget = 0;
    let glanceDirection = 1; // 1 = enyhén jobbra le, -1 = enyhén balra le

    let animTime = 0;

    // 1. Önálló pislogás
    const scheduleBlink = () => {
      const nextBlink = 2800 + Math.random() * 3400;
      this.schedule(() => {
        rig.classList.add('is-blinking');
        this.schedule(() => {
          rig.classList.remove('is-blinking');
          if (Math.random() < 0.22) {
            this.schedule(() => {
              rig.classList.add('is-blinking');
              this.schedule(() => rig.classList.remove('is-blinking'), 110);
            }, 160);
          }
        }, 125);
        scheduleBlink();
      }, nextBlink);
    };
    scheduleBlink();

    // 2. Kíváncsi pillantás a stabil pajzsra két fülmozgás között
    const triggerSignGlance = (holdDuration = 2200) => {
      glanceTarget = 1;
      targetEyeX = 1.1 * glanceDirection;
      targetEyeY = 2.4;

      this.schedule(() => {
        glanceTarget = 0;
        targetEyeX = 0;
        targetEyeY = 0;
        this.schedule(() => {
          if (glanceTarget === 0) {
            glanceDirection *= -1;
          }
        }, 900);
      }, holdDuration);
    }

    // 3. Fülbillentés (3.5 - 6.5 mp) és közte kíváncsi odapillantás
    const scheduleEarWiggle = () => {
      const nextWiggle = 4600 + Math.random() * 1900;
      this.schedule(() => {
        const choice = Math.random();
        if (choice < 0.42) {
          rig.classList.add('wiggle-left');
          this.schedule(() => rig.classList.remove('wiggle-left'), 620);
        } else if (choice < 0.84) {
          rig.classList.add('wiggle-right');
          this.schedule(() => rig.classList.remove('wiggle-right'), 620);
        } else {
          rig.classList.add('wiggle-left', 'wiggle-right');
          this.schedule(() => rig.classList.remove('wiggle-left', 'wiggle-right'), 620);
        }

        // Fülmozgás után kíváncsian a pajzsra pillant
        const delayToGlance = 1200;
        const holdDuration = Math.min(2200, Math.max(1400, nextWiggle - 2600));
        this.schedule(() => {
          triggerSignGlance(holdDuration);
        }, delayToGlance);

        scheduleEarWiggle();
      }, nextWiggle);
    };
    scheduleEarWiggle();

    // A referencia képkockánkénti 2.5D animációs ciklusa (a pajzs és a karok stabilak maradnak)
    const animate = () => {
      animTime += 0.015;

      glanceProgress += (glanceTarget - glanceProgress) * 0.05;

      // Lassú, gyermeki 2.5D ringatózás és lélegzés
      const baseTiltY = 0;
      const baseTiltX = 0;
      const swayAmpY = 5.4;
      const swayAmpX = 2.6;

      const targetRY = baseTiltY + Math.sin(animTime * 0.7) * swayAmpY + glanceProgress * 1.6 * glanceDirection;
      const targetRX = baseTiltX + Math.cos(animTime * 0.5) * swayAmpX - glanceProgress * 2.2;
      const targetFloatY = Math.sin(animTime * 0.95) * 2.5;

      currentRX += (targetRX - currentRX) * 0.05;
      currentRY += (targetRY - currentRY) * 0.05;
      currentFloatY += (targetFloatY - currentFloatY) * 0.05;

      // Pupillák finom követése
      currentEyeX += (targetEyeX - currentEyeX) * 0.07;
      currentEyeY += (targetEyeY - currentEyeY) * 0.07;

      pupilLeft.setAttribute('transform', `translate(${currentEyeX.toFixed(2)}, ${currentEyeY.toFixed(2)})`);
      pupilRight.setAttribute('transform', `translate(${currentEyeX.toFixed(2)}, ${currentEyeY.toFixed(2)})`);

      // Árnyék lélegzése
      if (shadowGroup) {
        const shadowScale = 1 - (targetFloatY / 35);
        shadowGroup.setAttribute('transform', `translate(200, 364) scale(${shadowScale.toFixed(3)}, 1) translate(-200, -364)`);
      }

      // Fő 3D rig forgatás és lebegés
      rig.style.transform = `translateY(${currentFloatY.toFixed(2)}px) rotateX(${currentRX.toFixed(2)}deg) rotateY(${currentRY.toFixed(2)}deg)`;

      // Rétegek 2.5D mélysége (Z) és parallax eltolása
      // A tábla (Z=42) és a mancsok (Z=52) azonos parallax szorzót (1.76) kapnak, így együtt mozognak elcsúszás nélkül
      const zMultiplier = 1.0;
      layers.forEach((layer) => {
        const baseZ = parseFloat(layer.dataset['baseZ'] || '0') * zMultiplier;
        const pFactor = parseFloat(layer.dataset['parallax'] || '1');
        const shiftX = currentRY * 0.72 * pFactor;
        const shiftY = -currentRX * 0.72 * pFactor;

        layer.style.transform = `translate3d(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px, ${baseZ.toFixed(1)}px)`;
      });

      this.frame = requestAnimationFrame(animate);
    };
    this.frame = requestAnimationFrame(animate);
  }
}
