import React, { Suspense, lazy, ComponentType } from 'react';

export type Loader = () => Promise<{ default: ComponentType<any> }>;

export interface DynamicOptions {
  loading?: ComponentType<any>;
  ssr?: boolean;
}

export function dynamic(
  loader: Loader,
  options: DynamicOptions = {}
): ComponentType<any> {
  const LazyComponent = lazy(loader);
  const Loading = options.loading || (() => null);
  const ssr = options.ssr ?? true;

  return function DynamicComponent(props: any) {
    // If SSR is disabled and we are on the server, return loading/null
    if (!ssr && typeof window === 'undefined') {
      return <Loading />;
    }

    return (
      <Suspense fallback={<Loading />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
