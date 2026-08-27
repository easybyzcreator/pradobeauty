import React from 'react';
import { motion } from 'motion/react';

export default function Footer() {
  return (
    <footer className="w-full py-8 flex flex-col items-center justify-center gap-0 mt-auto">
      <p className="text-[10px] tracking-[0.2em] font-sans font-bold text-white/50 uppercase">
        developed by
      </p>
      <a 
        href="https://www.easybyzcreator.com" 
        target="_blank" 
        rel="noopener noreferrer"
        className="group -mt-2"
      >
        <motion.img 
          src="https://i.ibb.co/Kj1CTDrD/patitour-2026-04-11-T125246-010.png" 
          alt="EasyByz Logo" 
          className="h-32 object-contain"
          initial={{ 
            filter: 'blur(0px) opacity(0.9) grayscale(0)',
            scale: 0.95
          }}
          whileHover={{ 
            filter: 'blur(0px) opacity(1) grayscale(0)',
            scale: 1.05
          }}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          referrerPolicy="no-referrer"
        />
      </a>
    </footer>
  );
}
