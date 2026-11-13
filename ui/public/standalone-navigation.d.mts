export type NavigationState = { canGoBack: boolean; isHome: boolean };
export function isStandaloneDisplay(): boolean;
export function installStandaloneNavigation(onChange: (state: NavigationState) => void): {
  sync(): void;
  back(goHome: () => void): void;
  dispose(): void;
} | null;
