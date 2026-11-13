"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { installStandaloneNavigation, type NavigationState } from "../public/standalone-navigation.mjs";

export function StandaloneBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const navigation = useRef<ReturnType<typeof installStandaloneNavigation>>(null);
  const [state, setState] = useState<NavigationState | null>(null);

  useEffect(() => {
    navigation.current = installStandaloneNavigation(setState);
    return () => navigation.current?.dispose();
  }, []);

  useEffect(() => { navigation.current?.sync(); }, [pathname]);

  if (!state || state.isHome) return null;
  const label = state.canGoBack ? "Back" : "Back to home";
  return (
    <button
      className="icon-button standalone-back-button"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => navigation.current?.back(() => router.replace("/"))}
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
  );
}
