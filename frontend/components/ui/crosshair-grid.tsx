import React from "react";

export function PlusMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 15 15"
      aria-hidden="true"
      className={`size-[15px] fill-black/15 pointer-events-none ${className}`}
    >
      <path d="M8 0H7V7H0V8H7V15H8V8H15V7H8V0Z" />
    </svg>
  );
}

export function CrosshairGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none -z-10">
      {/* Horizontal hairline borders */}
      <div className="absolute inset-x-0 top-16 border-t border-black/[0.04]" />
      <div className="absolute inset-x-0 top-24 border-t border-black/[0.04]" />
      <div className="absolute inset-x-0 top-96 border-t border-black/[0.04]" />
      <div className="absolute inset-x-0 top-[36rem] border-t border-black/[0.04]" />

      {/* Grid Plus Marks at intersections */}
      <div className="max-w-7xl mx-auto px-6 sm:px-8 h-full relative">
        <div className="absolute -top-2 left-8">
          <PlusMark />
        </div>
        <div className="absolute -top-2 left-1/4">
          <PlusMark />
        </div>
        <div className="absolute -top-2 left-1/2">
          <PlusMark />
        </div>
        <div className="absolute -top-2 left-3/4">
          <PlusMark />
        </div>
        <div className="absolute -top-2 right-8">
          <PlusMark />
        </div>

        <div className="absolute top-22 left-8">
          <PlusMark />
        </div>
        <div className="absolute top-22 left-1/4">
          <PlusMark />
        </div>
        <div className="absolute top-22 left-1/2">
          <PlusMark />
        </div>
        <div className="absolute top-22 left-3/4">
          <PlusMark />
        </div>
        <div className="absolute top-22 right-8">
          <PlusMark />
        </div>

        <div className="absolute top-94 left-8">
          <PlusMark />
        </div>
        <div className="absolute top-94 left-1/4">
          <PlusMark />
        </div>
        <div className="absolute top-94 left-1/2">
          <PlusMark />
        </div>
        <div className="absolute top-94 left-3/4">
          <PlusMark />
        </div>
        <div className="absolute top-94 right-8">
          <PlusMark />
        </div>
      </div>
    </div>
  );
}
