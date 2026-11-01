import React from 'react';
import { motion } from 'motion/react';
import { Settings } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface HeaderProps {
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings }) => {
  const handleOpen = () => {
    triggerHaptic('light');
    onOpenSettings();
  };

  return (
    <header className="sticky top-0 z-30 bg-[#F2F2F7]/85 dark:bg-black/80 backdrop-blur-xl border-b border-black/[0.04] dark:border-white/[0.06] transition-colors pt-[env(safe-area-inset-top,0px)]">
      <div className="max-w-xl mx-auto px-4 h-11 sm:h-12 flex items-center justify-between">
        {/* Minimal Wordmark */}
        <span className="font-semibold tracking-[0.22em] text-[12px] sm:text-[13px] text-neutral-900 dark:text-neutral-100 select-none uppercase">
          KAIRO
        </span>

        {/* Quiet Settings Trigger with haptic feedback & HIG 44×44pt hit area */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={handleOpen}
          aria-label="Settings and connected accounts"
          className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 active:opacity-70 transition-colors cursor-pointer"
        >
          <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </motion.button>
      </div>
    </header>
  );
};
