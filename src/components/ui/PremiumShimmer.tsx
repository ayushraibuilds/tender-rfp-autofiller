"use client";

import { motion } from "framer-motion";

interface PremiumShimmerProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
}

export function PremiumShimmer({
  className = "",
  width = "100%",
  height = "24px",
  borderRadius = "8px",
}: PremiumShimmerProps) {
  return (
    <div
      className={`relative overflow-hidden bg-white/5 border border-white/10 ${className}`}
      style={{ width, height, borderRadius }}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration: 1.5,
        }}
      />
    </div>
  );
}
