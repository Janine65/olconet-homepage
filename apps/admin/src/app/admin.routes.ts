import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, CanDeactivateFn, Routes } from '@angular/router';
import { AuthService } from './auth.service';

export interface AdminPage { canLeave(): boolean; }
const leavePage: CanDeactivateFn<AdminPage> = page => !inject(AuthService).user() || page.canLeave();
export class AdminRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot) {
    return super.shouldReuseRoute(future, current) && future.paramMap.get('id') === current.paramMap.get('id');
  }
}
const media = () => import('./media.component').then(module => module.MediaComponent);
const reports = () => import('./reports.component').then(module => module.ReportsComponent);

export const adminRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'uebersicht' },
  { path: 'uebersicht', title: 'Uebersicht | olconet Verwaltung',
    loadComponent: () => import('./overview.component').then(module => module.OverviewComponent) },
  { path: 'reiseberichte', title: 'Reiseberichte | olconet Verwaltung', loadComponent: reports, canDeactivate: [leavePage] },
  { path: 'reiseberichte/neu', title: 'Neuer Reisebericht | olconet Verwaltung',
    loadComponent: reports, data: { mode: 'new' }, canDeactivate: [leavePage] },
  { path: 'reiseberichte/:id', title: 'Bericht bearbeiten | olconet Verwaltung',
    loadComponent: reports, data: { mode: 'edit' }, canDeactivate: [leavePage] },
  { path: 'zeichnungen', pathMatch: 'full', redirectTo: 'kreationen' },
  { path: 'zeichnungen/neu', pathMatch: 'full', redirectTo: 'kreationen/neu' },
  { path: 'zeichnungen/upload', pathMatch: 'full', redirectTo: 'kreationen/upload' },
  { path: 'zeichnungen/sortieren', pathMatch: 'full', redirectTo: 'kreationen/sortieren' },
  { path: 'zeichnungen/bild/:id', pathMatch: 'full', redirectTo: 'kreationen/bild/:id' },
  ...(['kreationen', 'sammy', 'bildbibliothek'] as const).flatMap(path => {
    const category = path === 'kreationen' ? 'DRAWING' : path === 'sammy' ? 'SAMMY' : null;
    const label = path === 'kreationen' ? 'Meine Kreationen' : path === 'sammy' ? 'Sammy' : 'Bildbibliothek';
    const base = { loadComponent: media, canDeactivate: [leavePage] };
    const data = { category, basePath: path, label };
    return [
      { ...base, path, title: `${label} | olconet Verwaltung`, data: { ...data, mode: 'list' } },
      { ...base, path: `${path}/neu`, title: `Bild hochladen | olconet Verwaltung`, data: { ...data, mode: 'new' } },
      { ...base, path: `${path}/upload`, title: `${category ? 'Multi-Fotogruppe' : 'Mehrere Einzelbilder'} | olconet Verwaltung`, data: { ...data, mode: 'upload' } },
      ...(category ? [{ ...base, path: `${path}/sortieren`, title: `${label} sortieren | olconet Verwaltung`,
        data: { ...data, mode: 'sort' } }] : []),
      { ...base, path: `${path}/bild/:id`, title: `Bild oder Fotogruppe bearbeiten | olconet Verwaltung`, data: { ...data, mode: 'edit' } },
    ];
  }),
  { path: '**', title: 'Seite nicht gefunden | olconet Verwaltung',
    loadComponent: () => import('./overview.component').then(module => module.NotFoundComponent) },
];
