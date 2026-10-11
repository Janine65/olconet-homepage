import { Injectable, signal } from '@angular/core';

export interface AdminUser { id: string; email: string; displayName: string; }
export interface Overview { reports: number; drawings: number; sammyPhotos: number; }

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AdminUser | null>(null);

  private async response(path: string, body?: object | FormData): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: body === undefined ? {} : body instanceof FormData ? { 'X-Olconet-Request': '1' } : { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'Das Backend ist nicht erreichbar. Bitte die Verbindung pruefen.');
    }
    return this.checkResponse(response, path, body !== undefined);
  }

  private async checkResponse(response: Response, path: string, writing: boolean): Promise<Response> {
    if (!response.ok) {
      if (response.status === 401) this.user.set(null);
      const messages: Record<number, string> = {
        400: 'Die Eingaben sind ungueltig.',
        401: writing && path.endsWith('/login') ? 'E-Mail-Adresse oder Passwort ist falsch.' : 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
        403: 'Die Anfrage wurde abgelehnt. Bitte die konfigurierte Verwaltungsadresse verwenden.',
        429: path.endsWith('/login') ? 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' : 'Der Dienst ist ausgelastet. Bitte erneut versuchen.',
        404: 'Der angeforderte Inhalt wurde nicht gefunden.',
        409: 'Speicherkonflikt. Bitte die gespeicherte Version neu laden.',
        413: 'Die Anfrage ist zu gross.',
      };
      let message = messages[response.status] ?? 'Der Dienst ist voruebergehend nicht verfuegbar. Bitte erneut versuchen.';
      if ([400, 404, 409].includes(response.status)) {
        let data: unknown;
        try { data = await response.json(); }
        catch { throw new ApiError(response.status, 'Das Backend hat eine ungueltige Fehlerantwort geliefert.'); }
        if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
          message = data.message;
        }
      }
      throw new ApiError(response.status, message);
    }
    return response;
  }

  async upload(body: FormData, progress: (percent: number) => void): Promise<{ id: string }> {
    const path = '/api/admin/media';
    const response = await new Promise<Response>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', path);
      request.setRequestHeader('X-Olconet-Request', '1');
      request.timeout = 120000;
      request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      request.onload = () => {
        if (!request.status) { reject(new ApiError(0, 'Upload-Verbindung unterbrochen. Bitte erneut versuchen.')); return; }
        resolve(new Response(request.responseText, { status: request.status }));
      };
      request.onerror = () => reject(new ApiError(0, 'Upload-Verbindung unterbrochen. Bitte erneut versuchen.'));
      request.ontimeout = () => reject(new ApiError(0, 'Upload-Zeitlimit erreicht. Bitte erneut versuchen.'));
      request.send(body);
    });
    await this.checkResponse(response, path, true);
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ApiError(0, 'Ungueltige Upload-Antwort. Bitte erneut versuchen.'); }
    if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string') {
      throw new ApiError(0, 'Ungueltige Upload-Antwort. Bitte erneut versuchen.');
    }
    return { id: data.id };
  }

  async request<T>(path: string, body?: object | FormData): Promise<T> {
    const response = await this.response(path, body);
    try {
      return await response.json() as T;
    } catch {
      throw new ApiError(0, 'Das Backend hat eine ungueltige Antwort geliefert.');
    }
  }

  async restore() {
    try {
      const result = await this.request<{ user: AdminUser }>('/api/auth/me');
      this.user.set(result.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      throw error;
    }
  }

  async login(email: string, password: string) {
    const result = await this.request<{ user: AdminUser }>('/api/auth/login', { email, password });
    this.user.set(result.user);
  }

  async logout() {
    await this.response('/api/auth/logout', {});
    this.user.set(null);
  }
}
