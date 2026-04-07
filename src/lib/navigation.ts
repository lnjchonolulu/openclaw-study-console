export type AppNavItem = {
  href: string;
  title: string;
  description: string;
};

export const appNavItems: AppNavItem[] = [
  {
    href: "/chat",
    title: "Chat",
    description: "Talk to your personal agent and assign work.",
  },
  {
    href: "/files",
    title: "Files",
    description: "Upload, download, and share working materials.",
  },
  {
    href: "/agent",
    title: "Agent",
    description: "Tune tone, habits, and future persona settings.",
  },
  {
    href: "/team",
    title: "Team",
    description: "Coordinate with teammates without introducing a team agent.",
  },
];
