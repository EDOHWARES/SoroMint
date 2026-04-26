import React from 'react';

export const SkeletonCard = ({ className = '' }) => {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="bg-white/10 rounded-lg h-32 w-full"></div>
    </div>
  );
};

export const SkeletonList = ({ count = 5 }) => {
  return (
    <>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="animate-pulse py-4 border-b border-white/5">
          <div className="flex gap-4">
            <div className="bg-white/10 rounded h-4 flex-1"></div>
            <div className="bg-white/10 rounded h-4 flex-1"></div>
            <div className="bg-white/10 rounded h-4 flex-[2]"></div>
            <div className="bg-white/10 rounded h-4 w-16"></div>
          </div>
        </div>
      ))}
    </>
  );
};

export const SkeletonTokenForm = () => {
  return (
    <div className="animate-pulse space-y-4">
      <div className="bg-white/10 rounded h-8 w-3/4"></div>
      <div className="space-y-2">
        <div className="bg-white/10 rounded h-4 w-1/3"></div>
        <div className="bg-white/10 rounded h-10 w-full"></div>
      </div>
      <div className="space-y-2">
        <div className="bg-white/10 rounded h-4 w-1/4"></div>
        <div className="bg-white/10 rounded h-10 w-full"></div>
      </div>
      <div className="space-y-2">
        <div className="bg-white/10 rounded h-4 w-1/3"></div>
        <div className="bg-white/10 rounded h-10 w-full"></div>
      </div>
      <div className="bg-white/10 rounded h-10 w-full mt-4"></div>
    </div>
  );
};

export const SkeletonText = ({ lines = 1, className = '' }) => {
  return (
    <div className={`${className}`}>
      {[...Array(lines)].map((_, i) => (
        <div 
          key={i} 
          className="animate-pulse bg-white/10 rounded h-4 mb-2 last:mb-0"
          style={{ width: `${100 - (i * 10)}%` }}
        ></div>
      ))}
    </div>
  );
};

export const SkeletonAvatar = ({ size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24'
  };

  return (
    <div className={`animate-pulse bg-white/10 rounded-full ${sizeClasses[size]}`}></div>
  );
};
