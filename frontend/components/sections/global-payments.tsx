"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import rawGlobeData from "./globe-data.json";

type GlobePoint = [number, number, number, number];
type PaymentPoint = {
  city: string;
  region: string;
  activity: string;
  status: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  cardSide: "left" | "right";
  cardTop: number;
  color: "blue" | "green";
  drift: number;
  duration: number;
  delay: number;
};

const globeData = rawGlobeData as GlobePoint[];

const paymentPoints: PaymentPoint[] = [
  {
    city: "New York",
    region: "North America",
    activity: "Client paid",
    status: "Received",
    x: 156.5,
    y: 150.7,
    anchorX: 190,
    anchorY: 110,
    cardSide: "left",
    cardTop: 32,
    color: "green",
    drift: -6,
    duration: 4.8,
    delay: 0,
  },
  {
    city: "São Paulo",
    region: "Latin America",
    activity: "Contractor paid",
    status: "Settled",
    x: 218,
    y: 288,
    anchorX: 190,
    anchorY: 350,
    cardSide: "left",
    cardTop: 338,
    color: "blue",
    drift: 6,
    duration: 5.2,
    delay: 0.6,
  },
  {
    city: "London",
    region: "Europe",
    activity: "Payroll run",
    status: "Private",
    x: 309.2,
    y: 135.8,
    anchorX: 360,
    anchorY: 100,
    cardSide: "right",
    cardTop: 24,
    color: "blue",
    drift: -7,
    duration: 4.6,
    delay: 0.3,
  },
  {
    city: "Nairobi",
    region: "Africa",
    activity: "Vendor paid",
    status: "Approved",
    x: 353,
    y: 238,
    anchorX: 360,
    anchorY: 212,
    cardSide: "right",
    cardTop: 185,
    color: "green",
    drift: 5,
    duration: 5,
    delay: 0.9,
  },
  {
    city: "Singapore",
    region: "Asia",
    activity: "Team payout",
    status: "Settled",
    x: 446,
    y: 236,
    anchorX: 360,
    anchorY: 360,
    cardSide: "right",
    cardTop: 338,
    color: "blue",
    drift: -5,
    duration: 4.4,
    delay: 0.4,
  },
];

function PaymentCard({ point }: { point: PaymentPoint }) {
  const isGreen = point.color === "green";

  return (
    <motion.div
      animate={{ y: [0, point.drift, 0] }}
      transition={{ duration: point.duration, repeat: Infinity, ease: "easeInOut", delay: point.delay }}
      whileHover={{ scale: 1.04, y: point.drift < 0 ? point.drift - 2 : -4 }}
      className="absolute z-20 cursor-pointer"
      style={{
        width: "195px",
        top: `${point.cardTop}px`,
        [point.cardSide]: "8px",
      }}
    >
      <div className="flex items-stretch overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.07)] transition-shadow hover:shadow-xl">
        <div className={`w-1 shrink-0 ${isGreen ? "bg-[#00c076]" : "bg-[#0b44fe]"}`} />
        <div className="flex w-full items-center justify-between gap-2 p-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${
                isGreen ? "bg-[#00c076]" : "bg-[#0b44fe]"
              }`}
            >
              USDC
            </div>
            <div className="min-w-0">
              <div className="truncate text-[10.5px] font-bold leading-none text-gray-950">
                {point.city.toUpperCase()}
              </div>
              <div className="mt-1 text-[7px] font-semibold uppercase tracking-wider text-gray-400">
                {point.region} · {point.activity}
              </div>
              <div className="mt-1">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[6.5px] font-bold uppercase tracking-wider ${
                    isGreen
                      ? "border-emerald-200/40 bg-emerald-50 text-[#00a968]"
                      : "border-blue-200/40 bg-blue-50 text-[#0b44fe]"
                  }`}
                >
                  {point.status}
                </span>
              </div>
            </div>
          </div>
          <span className="shrink-0 whitespace-nowrap text-[10px] font-bold text-gray-900">••,••• USDC</span>
        </div>
      </div>
    </motion.div>
  );
}

export function GlobalPayments() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 2;
    const stageW = 560;
    const stageH = 480;
    const cx = 270;
    const cy = 240;
    const radius = 185;

    canvas.width = stageW * dpr;
    canvas.height = stageH * dpr;
    ctx.scale(dpr, dpr);

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.25, cx, cy, radius);
    glow.addColorStop(0, "rgba(59, 130, 246, 0.04)");
    glow.addColorStop(0.85, "rgba(59, 130, 246, 0.012)");
    glow.addColorStop(1, "rgba(59, 130, 246, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(59, 130, 246, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    for (const [x, y, isLand, cosC] of globeData) {
      ctx.beginPath();
      if (isLand === 1) {
        const alpha = Math.min(0.92, 0.48 + 0.48 * cosC);
        ctx.fillStyle = `rgba(11, 68, 254, ${alpha})`;
        const dotRadius = 1.35 * Math.min(1.3, Math.max(0.85, cosC + 0.3));
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      } else {
        const alpha = Math.min(0.18, 0.05 + 0.1 * cosC);
        ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
        ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }, []);

  return (
    <section id="proof" className="w-full overflow-hidden py-20 sm:py-28 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex items-center justify-center lg:col-span-7"
          >
            <div className="relative h-[480px] w-full max-w-[560px] select-none">
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full object-contain" />

              <svg className="pointer-events-none absolute inset-0 z-10 size-full" viewBox="0 0 560 480">
                <style>{`
                  @keyframes dashMove { to { stroke-dashoffset: -24; } }
                  .animate-flow-dash { animation: dashMove 3s linear infinite; }
                `}</style>
                {paymentPoints.map((point) => {
                  const color = point.color === "green" ? "#00c076" : "#0b44fe";
                  return (
                    <g key={point.city}>
                      <line
                        x1={point.anchorX}
                        y1={point.anchorY}
                        x2={point.x}
                        y2={point.y}
                        stroke={color}
                        strokeWidth="1.25"
                        strokeDasharray="4 4"
                        className="animate-flow-dash"
                      />
                      <circle cx={point.x} cy={point.y} r="3.5" fill={color} />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="8"
                        fill="none"
                        stroke={color}
                        strokeOpacity="0.4"
                        strokeWidth="1"
                        className="origin-center animate-ping"
                      />
                      <circle cx={point.x} cy={point.y} r="7" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1" />
                    </g>
                  );
                })}
              </svg>

              {paymentPoints.map((point) => (
                <PaymentCard key={point.city} point={point} />
              ))}

              <div className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 rounded-full border border-blue-100 bg-white/90 px-3 py-1.5 text-center font-mono text-[8px] font-bold uppercase tracking-wider text-[#0b44fe] shadow-sm backdrop-blur-sm">
                5 regions · one private operating account
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="space-y-6 lg:col-span-5 lg:pl-6"
          >
            <span className="mercury-section-kicker block text-[#0b44fe]">Global operations</span>
            <h2 className="mercury-section-title text-gray-950">
              Private company payments. <span className="text-[#0b44fe]">Clear settlement.</span>
            </h2>
            <p className="mercury-section-copy max-w-lg text-gray-500">
              Pay clients, contractors, vendors, and remote teams across regions while sensitive operating
              details stay confidential. Every payment has a clear status from request to settlement.
            </p>
            <div className="flex flex-wrap gap-2 text-xs font-medium text-gray-600">
              {["North America", "Latin America", "Europe", "Africa", "Asia"].map((region) => (
                <span key={region} className="rounded-full border border-gray-200 bg-white px-3 py-1.5">
                  {region}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
