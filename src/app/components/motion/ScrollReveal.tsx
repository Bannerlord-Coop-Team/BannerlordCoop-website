"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type ScrollRevealProps = {
    children: ReactNode;
    className?: string;
    delay?: number;
    distance?: number;
    amount?: number;
};

export function ScrollReveal({
                                 children,
                                 className,
                                 delay = 0,
                                 distance = 28,
                                 amount = 0.25,
                             }: ScrollRevealProps) {
    const shouldReduceMotion = useReducedMotion();

    return (
        <motion.div
            className={className}
            initial={{
                opacity: 0,
                y: shouldReduceMotion ? 0 : distance,
            }}
            whileInView={{
                opacity: 1,
                y: 0,
            }}
            viewport={{
                once: true,
                amount,
            }}
            transition={{
                duration: shouldReduceMotion ? 0 : 0.6,
                delay: shouldReduceMotion ? 0 : delay,
                ease: [0.22, 1, 0.36, 1],
            }}
        >
            {children}
        </motion.div>
    );
}