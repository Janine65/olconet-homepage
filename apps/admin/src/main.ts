import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter, RouteReuseStrategy, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { adminRoutes, AdminRouteReuseStrategy } from './app/admin.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(adminRoutes, withHashLocation(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    { provide: RouteReuseStrategy, useClass: AdminRouteReuseStrategy },
  ],
}).catch((error: unknown) => {
  console.error('Die Verwaltung konnte nicht gestartet werden.', error);
  const root = document.querySelector('app-root');
  if (root) root.textContent = 'Die Verwaltung konnte nicht geladen werden. Bitte lade die Seite erneut.';
});
