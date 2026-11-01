import React from 'react';
import { motion } from 'motion/react';

interface DailyBriefingProps {
  greeting: string;
  sentences: string[];
}

export const DailyBriefing: React.FC<DailyBriefingProps> = ({ greeting, sentences }) => {
  if (sentences.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="px-4 pt-4 sm:pt-6 pb-4 max-w-xl mx-auto w-full select-none"
    >
      {/* Warm personal greeting (Apple Large Title 30-32pt) */}
      <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mb-2.5">
        {greeting}
      </h1>

      {/* Conversational briefing prose (Apple Body 17pt, leading 1.55) */}
      <div className="text-[15px] sm:text-[17px] leading-[1.55] text-neutral-600 dark:text-neutral-300 font-normal">
        {sentences.map((sentence, idx) => (
          <span key={idx} className="mr-1.5 inline">
            {sentence}
          </span>
        ))}
      </div>
    </motion.section>
  );
};
