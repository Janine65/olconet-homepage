import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationError, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import type { AdminPage } from './admin.routes';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private page: AdminPage | null = null;
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  email = '';
  password = '';
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationError) {
        this.error.set('Die Verwaltungsseite konnte nicht geladen werden. Bitte die Verbindung pruefen und die Seite neu laden.');
      }
    });
  }
  activate(page: unknown) {
    this.page = page && typeof page === 'object' && 'canLeave' in page && typeof page.canLeave === 'function'
      ? page as AdminPage : null;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus());
  }

  async ngOnInit() {
    await this.restore();
  }

  async restore() {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.restore();
    } catch (error) {
      this.showError(error);
    } finally {
      this.loading.set(false);
    }
  }

  async login() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.email, this.password);
      this.password = '';
    } catch (error) {
      this.password = '';
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  async logout() {
    if (this.busy()) return;
    if (this.page && !this.page.canLeave()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.logout();
      this.page = null;
      await this.router.navigateByUrl('/uebersicht', { replaceUrl: true });
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private showError(error: unknown) {
    this.error.set(error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.');
  }
}
