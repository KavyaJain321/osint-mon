"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
    const [theme, setTheme] = useState<"dark" | "light">("dark");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Check for existing class or localStorage
        const isLight = document.documentElement.classList.contains("light");
        setTheme(isLight ? "light" : "dark");
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === "dark" ? "light" : "dark";
        setTheme(newTheme);
        localStorage.setItem("theme-preference", newTheme);
        
        if (newTheme === "light") {
            document.documentElement.classList.add("light");
        } else {
            document.documentElement.classList.remove("light");
        }
    };

    if (!mounted) {
        // Render a placeholder to avoid layout shift before hydration
        return <div className="w-6 h-6" />;
    }

    return (
        <button
            onClick={toggleTheme}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-slate-800/40 transition-colors"
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
    );
}
