import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="login">
      <h1 tabindex="-1">Konto</h1>
      @if (auth.user(); as user) {
        <p>{{ user.displayName }} ({{ user.email }})</p>
      }
      <h2>Passwort ändern</h2>
      <p>Das neue Passwort muss mindestens 12 Zeichen enthalten. Nach der Änderung werden alle Sitzungen dieses Kontos beendet.</p>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <form #form="ngForm" (ngSubmit)="changePassword()">
        <label for="current-password">Aktuelles Passwort</label>
        <input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128" [(ngModel)]="currentPassword" [disabled]="busy()">
        <label for="new-password">Neues Passwort</label>
        <input id="new-password" name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" [(ngModel)]="newPassword" [disabled]="busy()">
        <label for="confirm-password">Neues Passwort wiederholen</label>
        <input id="confirm-password" name="confirmation" type="password" autocomplete="new-password" required maxlength="128" [(ngModel)]="confirmation" [disabled]="busy()">
        <button type="submit" [disabled]="busy() || form.invalid">{{ busy() ? 'Passwort wird geändert ...' : 'Passwort ändern' }}</button>
      </form>
    </section>
  `,
})
export class AccountComponent {
  readonly auth = inject(AuthService);
  readonly busy = signal(false);
  readonly error = signal('');
  currentPassword = '';
  newPassword = '';
  confirmation = '';

  async changePassword() {
    if (this.busy()) return;
    if (this.newPassword !== this.confirmation) {
      this.error.set('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.newPassword = this.confirmation = '';
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Das Passwort konnte nicht geändert werden.');
    } finally {
      this.currentPassword = '';
      this.busy.set(false);
    }
  }
}
