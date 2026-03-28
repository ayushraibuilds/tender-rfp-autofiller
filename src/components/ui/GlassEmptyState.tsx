import { ReactNode } from "react";

interface GlassEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function GlassEmptyState({ icon, title, description, action }: GlassEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl" style={{ boxShadow: "0 10px 40px -10px rgba(0,0,0,0.5)" }}>
      <div className="flex items-center justify-center w-20 h-20 mb-6 bg-white/10 rounded-full text-white/60">
        {icon}
      </div>
      <h3 className="mb-2 text-xl font-semibold text-white tracking-tight">{title}</h3>
      <p className="max-w-sm mb-6 text-sm text-white/60">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
