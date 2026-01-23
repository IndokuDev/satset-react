import React from 'react';

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  loading?: 'lazy' | 'eager';
  quality?: number;
  placeholder?: 'blur' | 'empty';
  blurDataURL?: string;
}

export default function Image({
  src,
  alt,
  width,
  height,
  priority = false,
  loading = 'lazy',
  quality = 75,
  placeholder,
  blurDataURL,
  className,
  style,
  ...props
}: ImageProps) {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);

  // Determine actual loading strategy
  const actualLoading = priority ? 'eager' : loading;

  React.useEffect(() => {
    if (priority && imgRef.current) {
      // Preload priority images
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = src;
      document.head.appendChild(link);
    }
  }, [priority, src]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setError(true);
    console.error(`[Satset Image] Failed to load: ${src}`);
  };

  const imgStyle: React.CSSProperties = {
    ...style,
    opacity: isLoaded ? 1 : 0,
    transition: 'opacity 0.3s ease-in-out',
  };

  if (placeholder === 'blur' && blurDataURL && !isLoaded) {
    imgStyle.filter = 'blur(10px)';
  }

  return (
    <div
      style={{
        position: 'relative',
        width: width ? `${width}px` : '100%',
        height: height ? `${height}px` : 'auto',
      }}
    >
      {placeholder === 'blur' && blurDataURL && !isLoaded && (
        <img
          src={blurDataURL}
          alt=""
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(20px)',
          }}
          aria-hidden="true"
        />
      )}
      
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={actualLoading}
        onLoad={handleLoad}
        onError={handleError}
        className={className}
        style={imgStyle}
        {...props}
      />

      {error && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f0f0f0',
            color: '#999',
          }}
        >
          Image failed to load
        </div>
      )}
    </div>
  );
}