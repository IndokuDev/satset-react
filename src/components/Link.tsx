import React from 'react';

interface LinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  target?: string;
  rel?: string;
}

export default function Link({
  href,
  children,
  className,
  prefetch = true,
  replace = false,
  scroll = true,
  target,
  rel,
}: LinkProps) {
  const linkRef = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    // Prefetch on hover/focus
    if (prefetch && linkRef.current) {
      const handleMouseEnter = () => {
        prefetchRoute(href);
      };

      const handleFocus = () => {
        prefetchRoute(href);
      };

      const link = linkRef.current;
      link.addEventListener('mouseenter', handleMouseEnter);
      link.addEventListener('focus', handleFocus);

      return () => {
        link.removeEventListener('mouseenter', handleMouseEnter);
        link.removeEventListener('focus', handleFocus);
      };
    }
  }, [href, prefetch]);

  const handleClick = (e: React.MouseEvent) => {
    // Allow default behavior for external links or special keys
    if (
      target === '_blank' ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }

    e.preventDefault();

    // Navigate
    if (replace) {
      window.history.replaceState({}, '', href);
    } else {
      window.history.pushState({}, '', href);
    }

    // Scroll to top if needed
    if (scroll) {
      window.scrollTo(0, 0);
    }

    // Dispatch popstate event
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <a
      ref={linkRef}
      href={href}
      onClick={handleClick}
      className={className}
      target={target}
      rel={rel}
    >
      {children}
    </a>
  );
}

// Prefetch route data
function prefetchRoute(href: string) {
  // Create link element for prefetch
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.appendChild(link);
}