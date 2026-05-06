export type AppNavItem = {
  href: string;
  title: string;
  description: string;
};

export const primaryNavItems: AppNavItem[] = [
  {
    href: "/chat",
    title: "DM",
    description: "Talk to your personal agent and assign work.",
  },
  {
    href: "/team",
    title: "Team Chat",
    description: "Coordinate with teammates without introducing a team agent.",
  },
  {
    href: "/files",
    title: "Files",
    description: "Upload, download, and share working materials.",
  },
];

export const secondaryNavItems: AppNavItem[] = [
  {
    href: "/agent",
    title: "Setting",
    description: "Tune tone, habits, and future persona settings.",
  },
];
