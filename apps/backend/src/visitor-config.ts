export function visitorTrackingTestMode(env: NodeJS.ProcessEnv): boolean {
  return (env['NODE_ENV'] === undefined || env['NODE_ENV'] === 'development') &&
    env['PUBLIC_VISITOR_TRACKING_TEST_MODE'] === 'true';
}

export function visitorTrackingEnabled(env: NodeJS.ProcessEnv): boolean {
  return visitorTrackingTestMode(env) || (
    env['NODE_ENV'] === 'production' &&
    !!env['VISITOR_PROXY_SECRET'] &&
    !!env['VISITOR_TRUSTED_PROXIES']?.trim()
  );
}
